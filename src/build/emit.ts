import { copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ThemeAsset, ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';

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

export async function copyContentAssets(
  cwd: string,
  contentImagesDir: string,
  outputDir: string,
): Promise<number> {
  const source = join(cwd, contentImagesDir);
  const target = join(outputDir, 'content/images');
  const glob = new Bun.Glob('**/*');
  let count = 0;
  try {
    for await (const rel of glob.scan({ cwd: source, onlyFiles: true })) {
      const src = join(source, rel);
      const dst = join(target, rel);
      await ensureDir(dirname(dst));
      await copyFile(src, dst);
      count += 1;
    }
  } catch {
    // content/images is optional
  }
  return count;
}
