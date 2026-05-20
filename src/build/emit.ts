import { copyFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';
import { pLimit } from '~/util/concurrency.ts';
import { NectarError } from '~/util/errors.ts';
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

// Chunk size for the HTML write phase. Render produces every route's HTML into
// memory before any write starts, so a 10k-route site holds ~10k strings of
// O(20KB) each — easily hundreds of MB. Writing in chunks lets each batch's
// strings be released by the GC as soon as the chunk resolves, instead of
// pinning the full set until the entire `Promise.all` settles. 512 is the
// middle of the 256-1024 sweet spot the perf note suggested: large enough that
// scheduler overhead and per-chunk ensureDirs are amortised, small enough that
// peak retained HTML stays bounded.
const WRITE_BATCH_SIZE = 512;

function assertWithinOutputDir(outputDir: string, dest: string): void {
  const root = resolve(outputDir);
  const target = resolve(dest);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
    throw new NectarError({
      message: `Refusing to write outside output directory: outputDir=${root} dest=${target}`,
      code: 'emit',
    });
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

// Sibling of writeHtml for binary payloads (sitemap `.xml.gz` companions,
// future gzipped JSON feeds, …). Keeps the same path-safety guarantees so
// callers can't escape `outputDir` via crafted paths.
export async function writeBytes(
  outputDir: string,
  outputPath: string,
  data: Uint8Array,
): Promise<void> {
  const dest = join(outputDir, outputPath);
  assertWithinOutputDir(outputDir, dest);
  await ensureDir(dirname(dest));
  await writeFile(dest, data);
}

export interface HtmlOutput {
  outputPath: string;
  html: string;
  // True when `html` was loaded from the previous build's output instead of
  // being freshly rendered. The minify pass uses this flag to skip work that
  // has already been done; writers treat reused and rendered entries the same.
  reused?: boolean;
}

// Batched companion to writeHtml. Validation happens up front so an escape
// attempt anywhere in `outputs` rejects before any file is written. The actual
// disk work is then split into fixed-size chunks: within a chunk parent dirs
// are deduped and `Bun.write` fans out via `Promise.all`; chunks run
// sequentially so the per-chunk HTML strings drop out of the live set before
// the next batch starts. For a 10k-route site this caps peak retained HTML at
// roughly WRITE_BATCH_SIZE entries instead of the full 10k.
//
// `Bun.write` is preferred over `node:fs.writeFile` here: it bypasses libuv's
// per-call allocations and is materially faster for many small files, which is
// exactly the shape of the route-write phase.
export async function writeHtmlBatch(outputDir: string, outputs: HtmlOutput[]): Promise<void> {
  if (outputs.length === 0) return;
  const dests: string[] = new Array(outputs.length);
  for (let i = 0; i < outputs.length; i++) {
    const entry = outputs[i];
    if (entry === undefined) throw new Error('writeHtmlBatch: output entry missing');
    const dest = join(outputDir, entry.outputPath);
    assertWithinOutputDir(outputDir, dest);
    dests[i] = dest;
  }
  for (let start = 0; start < outputs.length; start += WRITE_BATCH_SIZE) {
    const end = Math.min(start + WRITE_BATCH_SIZE, outputs.length);
    const chunkDirs: string[] = new Array(end - start);
    for (let i = start; i < end; i++) {
      const dest = dests[i];
      if (dest === undefined) throw new Error('writeHtmlBatch: dest missing for output');
      chunkDirs[i - start] = dirname(dest);
    }
    await ensureDirs(chunkDirs);
    await Promise.all(
      Array.from({ length: end - start }, (_, j) => {
        const i = start + j;
        const dest = dests[i];
        const entry = outputs[i];
        if (dest === undefined || entry === undefined) {
          throw new Error('writeHtmlBatch: chunk entry missing');
        }
        return Bun.write(dest, entry.html);
      }),
    );
  }
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
