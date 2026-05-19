import { copyFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';
import { ensureDir, pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Raster formats the size cap applies to. SVG is intrinsically scalable so a
// large byte count there is unusual and the cap would just confuse users;
// non-image formats (PDF/video under content/files & content/media) are out
// of scope for the LCP-image problem this guard exists to solve.
const RASTER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

function assertWithinOutputDir(outputDir: string, dest: string): void {
  const root = resolve(outputDir);
  const target = resolve(dest);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
    throw new Error(`Refusing to write outside output directory: outputDir=${root} dest=${target}`);
  }
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

export async function copyAssets(theme: ThemeBundle, outputDir: string): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  for (const asset of theme.assets.values()) {
    if (seen.has(`${asset.sourcePath}|${asset.fingerprintedPath}`)) continue;
    seen.add(`${asset.sourcePath}|${asset.fingerprintedPath}`);
    await emitAsset(asset, outputDir);
    count += 1;
  }
  return count;
}

async function emitAsset(asset: ThemeAsset, outputDir: string): Promise<void> {
  const dest = join(outputDir, asset.fingerprintedPath);
  await ensureDir(dirname(dest));
  await copyFile(asset.sourcePath, dest);
  if (asset.fingerprintedPath !== asset.logicalPath) {
    const logicalDest = join(outputDir, asset.logicalPath);
    await ensureDir(dirname(logicalDest));
    await copyFile(asset.sourcePath, logicalDest);
  }
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
  let count = 0;
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
      const dst = join(target, rel);
      await ensureDir(dirname(dst));
      await copyFile(src, dst);
      count += 1;
    }
  } catch {
    // optional: directory may not exist
  }
  return count;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
