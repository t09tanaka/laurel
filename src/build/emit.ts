import { copyFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';
import { pLimit } from '~/util/concurrency.ts';
import { ensureDir, pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Raster formats the size cap applies to. SVG is intrinsically scalable so a
// large byte count there is unusual and the cap would just confuse users;
// non-image formats (PDF/video under content/files & content/media) are out
// of scope for the LCP-image problem this guard exists to solve.
const RASTER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

// Bounded fan-out for per-file fs writes. 32 is comfortably under the typical
// soft file-descriptor limit (1024) even when other code paths hold fds, and
// big enough to hide ensureDir/writeFile latency on real sites.
const EMIT_CONCURRENCY = 32;

function assertWithinOutputDir(outputDir: string, dest: string): void {
  const root = resolve(outputDir);
  const target = resolve(dest);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
    throw new Error(`Refusing to write outside output directory: outputDir=${root} dest=${target}`);
  }
}

async function ensureDirs(dirs: Iterable<string>): Promise<void> {
  await Promise.all(Array.from(new Set(dirs), (d) => ensureDir(d)));
}

export async function writeHtml(
  outputDir: string,
  outputPath: string,
  html: string,
): Promise<void> {
  const dest = join(outputDir, outputPath);
  assertWithinOutputDir(outputDir, dest);
  await ensureDir(dirname(dest));
  await writeFile(dest, html, 'utf8');
}

export interface HtmlOutput {
  outputPath: string;
  html: string;
}

// Batched companion to writeHtml: validate + dedupe parent dirs up front, then
// fan out the per-file writeFile calls under a concurrency cap. Used by the
// render loop, which produces hundreds of routes that previously serialised
// behind `await ensureDir; await writeFile` per route.
export async function writeHtmlBatch(outputDir: string, outputs: HtmlOutput[]): Promise<void> {
  if (outputs.length === 0) return;
  const dests: string[] = [];
  const dirs: string[] = [];
  for (const { outputPath } of outputs) {
    const dest = join(outputDir, outputPath);
    assertWithinOutputDir(outputDir, dest);
    dests.push(dest);
    dirs.push(dirname(dest));
  }
  await ensureDirs(dirs);
  const limit = pLimit(EMIT_CONCURRENCY);
  await Promise.all(
    outputs.map((out, i) => {
      const dest = dests[i];
      if (dest === undefined) throw new Error('writeHtmlBatch: dest missing for output');
      return limit(() => writeFile(dest, out.html, 'utf8'));
    }),
  );
}

// Only the fingerprinted copy is emitted. The `{{asset}}` helper always
// resolves to `fingerprintedPath` (see src/render/helpers/assets.ts), so the
// logical-path duplicate was dead weight on disk and double the upload —
// themes with megabytes of fonts/CSS used to pay 2x. See backlog #1106.
export async function copyAssets(theme: ThemeBundle, outputDir: string): Promise<number> {
  const seen = new Set<string>();
  const unique: ThemeAsset[] = [];
  for (const asset of theme.assets.values()) {
    const key = `${asset.sourcePath}|${asset.fingerprintedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(asset);
  }
  if (unique.length === 0) return 0;

  await ensureDirs(unique.map((asset) => dirname(join(outputDir, asset.fingerprintedPath))));

  const limit = pLimit(EMIT_CONCURRENCY);
  await Promise.all(unique.map((asset) => limit(() => emitAsset(asset, outputDir))));
  return unique.length;
}

async function emitAsset(asset: ThemeAsset, outputDir: string): Promise<void> {
  const dest = join(outputDir, asset.fingerprintedPath);
  await copyFile(asset.sourcePath, dest);
}

export interface CopyContentAssetsOptions {
  // Skip raster image files (under contentImagesDir) larger than this many
  // bytes, logging a warning per skip. 0 (or undefined) disables the check.
  maxImageBytes?: number;
}

export async function copyContentAssets(
  cwd: string,
  contentImagesDir: string,
  outputDir: string,
  options?: CopyContentAssetsOptions,
): Promise<number> {
  const maxImageBytes = options?.maxImageBytes ?? 0;
  let total = 0;
  total += await copyTree(join(cwd, contentImagesDir), join(outputDir, 'content/images'), {
    maxImageBytes,
  });
  // content/files and content/media come straight from Ghost exports
  // (import-ghost copies them next to content/images). They mirror Ghost's
  // /content/<name>/ URL layout so imported markdown links resolve. The image
  // size cap is intentionally not applied here: these dirs hold PDFs, video,
  // and audio, which are not LCP candidates and have legitimate large-file
  // use cases.
  total += await copyTree(join(cwd, 'content/files'), join(outputDir, 'content/files'), {
    maxImageBytes: 0,
  });
  total += await copyTree(join(cwd, 'content/media'), join(outputDir, 'content/media'), {
    maxImageBytes: 0,
  });
  return total;
}

interface CopyTreeOptions {
  maxImageBytes: number;
}

async function copyTree(source: string, target: string, opts: CopyTreeOptions): Promise<number> {
  const glob = new Bun.Glob('**/*');
  const tasks: Array<{ src: string; dst: string }> = [];
  try {
    for await (const rel of glob.scan({ cwd: source, onlyFiles: true })) {
      if (pathContainsSymlink(source, rel)) {
        logger.warn(`Skipping symlinked content asset: ${join(source, rel)}`);
        continue;
      }
      const src = join(source, rel);
      if (opts.maxImageBytes > 0 && RASTER_IMAGE_EXTS.has(extname(rel).toLowerCase())) {
        const size = Bun.file(src).size;
        if (size > opts.maxImageBytes) {
          logger.warn(
            `Skipping oversized image ${src}: ${formatBytes(size)} exceeds build.max_image_bytes=${formatBytes(opts.maxImageBytes)}. Resize the source (e.g. to 2400px max width) or raise build.max_image_bytes.`,
          );
          continue;
        }
      }
      tasks.push({ src, dst: join(target, rel) });
    }
  } catch {
    // optional: directory may not exist
  }
  if (tasks.length === 0) return 0;

  await ensureDirs(tasks.map((t) => dirname(t.dst)));
  const limit = pLimit(EMIT_CONCURRENCY);
  await Promise.all(tasks.map((t) => limit(() => copyFile(t.src, t.dst))));
  return tasks.length;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
