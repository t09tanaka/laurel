import { existsSync, statSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pLimit } from '~/util/concurrency.ts';
import { NectarError } from '~/util/errors.ts';
import { ensureDir, pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';

// Bounded fan-out for per-file fs copies. Matches EMIT_CONCURRENCY in emit.ts so
// large static trees do not exhaust the file-descriptor table on real sites.
const COPY_CONCURRENCY = 32;

// Mirrors the user's `<cwd>/<staticDir>` tree into the output root. It runs as
// the final emit step so ordinary files dropped here win over generated output,
// while deploy metadata files can be protected from silent replacement.
// Symlinked entries are skipped (same defence as `copyContentAssets`) so a
// malicious `static/oops.txt -> /home/runner/.npmrc` cannot escape into the
// published site. A missing or empty directory is a no-op.
export async function copyStaticDir(opts: {
  cwd: string;
  staticDir: string;
  outputDir: string;
  onOutputPath?: ((path: string) => void) | undefined;
  generatedConflict?:
    | {
        paths: readonly string[];
        force?: boolean | undefined;
        merge?: boolean | undefined;
      }
    | undefined;
}): Promise<number> {
  const { cwd, staticDir, outputDir } = opts;
  if (staticDir.length === 0) return 0;

  const source = resolve(cwd, staticDir);
  const tasks: Array<{ src: string; dst: string }> = [];
  let rels: string[] = [];
  try {
    rels = await scanGlob('**/*', { cwd: source, onlyFiles: true, dot: true });
  } catch {
    // Directory may not exist — passthrough is optional, so swallow.
  }
  for (const rel of rels) {
    if (pathContainsSymlink(source, rel)) {
      logger.warn(`Skipping symlinked static passthrough file: ${join(source, rel)}`);
      continue;
    }
    tasks.push({ src: join(source, rel), dst: join(outputDir, rel) });
    opts.onOutputPath?.(toPosix(rel));
  }
  if (tasks.length === 0) return 0;

  const dirs = new Set(tasks.map((t) => dirname(t.dst)));
  await Promise.all(Array.from(dirs, (d) => ensureDir(d)));
  const limit = pLimit(COPY_CONCURRENCY);
  const protectedPaths = new Set(
    (opts.generatedConflict?.paths ?? [])
      .map((p) => normalizeStaticRelPath(p))
      .filter((p): p is string => p !== undefined),
  );
  await Promise.all(
    tasks.map((t) =>
      limit(async () => {
        const rel = normalizeStaticRelPath(relativeToOutput(outputDir, t.dst));
        if (!rel || !protectedPaths.has(rel) || !existsSync(t.dst)) {
          await copyFile(t.src, t.dst);
          return;
        }
        if (opts.generatedConflict?.force === true) {
          await copyFile(t.src, t.dst);
          return;
        }
        if (opts.generatedConflict?.merge === true) {
          await mergeDeployArtifact(t.src, t.dst, rel);
          return;
        }
        throw new NectarError({
          code: 'emit',
          message: `${join(staticDir, rel)} conflicts with a generated deploy artifact at ${rel}.`,
          hint: 'Remove the hand-written static file, pass --force to overwrite the generated artifact, or set deploy.merge = true to merge supported deploy artifacts.',
        });
      }),
    ),
  );
  return tasks.length;
}

export function resolveStaticPassthroughDirs(opts: {
  cwd: string;
  staticDir: string;
}): string[] {
  const { cwd, staticDir } = opts;
  if (staticDir.length === 0) return [];
  if (
    staticDir === 'static' &&
    !dirExists(resolve(cwd, 'static')) &&
    dirExists(resolve(cwd, 'public'))
  ) {
    return ['public'];
  }
  return [staticDir];
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function relativeToOutput(outputDir: string, dst: string): string {
  const prefix = outputDir.endsWith(sep) ? outputDir : `${outputDir}${sep}`;
  return dst.startsWith(prefix) ? dst.slice(prefix.length) : dst;
}

function normalizeStaticRelPath(path: string): string | undefined {
  const normalized = toPosix(path).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return normalized;
}

async function mergeDeployArtifact(src: string, dst: string, rel: string): Promise<void> {
  if (rel === 'vercel.json') {
    await mergeVercelJson(src, dst);
    return;
  }
  const [handWritten, generated] = await Promise.all([
    readFile(src, 'utf8'),
    readFile(dst, 'utf8'),
  ]);
  await writeFile(dst, mergeTextDeployArtifact(handWritten, generated));
}

function mergeTextDeployArtifact(handWritten: string, generated: string): string {
  const left = handWritten.replace(/\n+$/, '');
  const right = generated.replace(/^\n+/, '');
  if (left.length === 0) return right;
  if (right.length === 0) return `${left}\n`;
  return `${left}\n\n${right}`;
}

async function mergeVercelJson(src: string, dst: string): Promise<void> {
  const [handWrittenBody, generatedBody] = await Promise.all([
    readFile(src, 'utf8'),
    readFile(dst, 'utf8'),
  ]);
  const handWritten = parseVercelConfig(handWrittenBody, src);
  const generated = parseVercelConfig(generatedBody, dst);
  const merged: Record<string, unknown> = { ...generated, ...handWritten };
  const headers = mergeVercelArray(handWritten.headers, generated.headers);
  const redirects = mergeVercelArray(handWritten.redirects, generated.redirects);
  if (headers !== undefined) merged.headers = headers;
  if (redirects !== undefined) merged.redirects = redirects;
  await writeFile(dst, `${JSON.stringify(merged, null, 2)}\n`);
}

function parseVercelConfig(body: string, file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    throw new NectarError({
      code: 'emit',
      message: `Invalid vercel.json while merging deploy artifacts: ${file}`,
      cause: err,
    });
  }
  throw new NectarError({
    code: 'emit',
    message: `Invalid vercel.json while merging deploy artifacts: ${file}`,
  });
}

function mergeVercelArray(left: unknown, right: unknown): unknown[] | undefined {
  const items: unknown[] = [];
  if (Array.isArray(left)) items.push(...left);
  if (Array.isArray(right)) items.push(...right);
  return items.length > 0 ? items : undefined;
}
