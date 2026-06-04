import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { CLEAN_SPEC } from '../specs.ts';

interface CleanTarget {
  path: string;
  exists: boolean;
  bytes: number;
  kept: string[];
}

interface CleanResult {
  cwd: string;
  targets: CleanTarget[];
  removed: string[];
  kept: string[];
  total_bytes: number;
  dry_run: boolean;
}

export async function runClean(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CLEAN_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CLEAN_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CLEAN_SPEC));
    return 0;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const asJson = parsed.values.json === true;
  const dryRun = parsed.values['dry-run'] === true;
  const skipConfirm = parsed.values.yes === true || dryRun;
  const keepRaw = typeof parsed.values.keep === 'string' ? parsed.values.keep : '';
  const keepEntries = keepRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let outputDir = 'dist';
  try {
    const config = await loadConfig({ cwd, configPath });
    outputDir = config.build.output_dir;
  } catch {
    // Cleaning should still work when laurel.toml is missing or invalid:
    // operators reach for `laurel clean` precisely when something is wrong.
    // Fall back to the schema default so we at least nuke `dist/`.
  }

  const distAbs = resolve(cwd, outputDir);
  const cacheAbs = resolve(cwd, '.laurel/cache');
  const candidates = [distAbs, cacheAbs];

  // Refuse to touch anything outside cwd. resolve() collapses `..` so a
  // configured `output_dir = "../foo"` would normally escape; we explicitly
  // verify the resolved path is contained.
  for (const path of candidates) {
    if (!isInside(cwd, path)) {
      const msg = `Refusing to delete a path outside of ${cwd}: ${path}`;
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
      } else {
        process.stderr.write(`${msg}\n`);
      }
      return 2;
    }
  }

  const targets: CleanTarget[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) {
      targets.push({ path, exists: false, bytes: 0, kept: [] });
      continue;
    }
    const bytes = await dirBytes(path);
    const kept = keepEntries
      .map((entry) => resolve(cwd, entry))
      .filter((abs) => isInside(path, abs) && existsSync(abs))
      .map((abs) => relative(cwd, abs));
    targets.push({ path, exists: true, bytes, kept });
  }

  const totalBytes = targets.reduce((acc, t) => acc + t.bytes, 0);
  const willRemove = targets.filter((t) => t.exists);

  if (willRemove.length === 0) {
    const result: CleanResult = {
      cwd,
      targets,
      removed: [],
      kept: [],
      total_bytes: 0,
      dry_run: dryRun,
    };
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      logger.info('Nothing to clean (dist/ and .laurel/cache do not exist).');
    }
    return 0;
  }

  if (!asJson && !dryRun) {
    process.stdout.write('The following paths will be removed:\n');
    for (const t of willRemove) {
      process.stdout.write(`  ${relative(cwd, t.path) || t.path}  (${formatBytes(t.bytes)})\n`);
      for (const k of t.kept) {
        process.stdout.write(`    (keeping ${k})\n`);
      }
    }
  }

  if (!skipConfirm) {
    const yes = await confirm('Proceed? [y/N] ');
    if (!yes) {
      logger.info('Aborted.');
      return 0;
    }
  }

  const removed: string[] = [];
  const keptOverall: string[] = [];
  if (!dryRun) {
    for (const t of willRemove) {
      try {
        if (t.kept.length === 0) {
          await rm(t.path, { recursive: true, force: true });
        } else {
          await removeWithKeep(
            t.path,
            t.kept.map((k) => resolve(cwd, k)),
          );
        }
        removed.push(relative(cwd, t.path) || t.path);
        keptOverall.push(...t.kept);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errOut = `Failed to remove ${t.path}: ${msg}`;
        if (asJson) {
          process.stdout.write(`${JSON.stringify({ error: errOut }, null, 2)}\n`);
        } else {
          process.stderr.write(`${errOut}\n`);
        }
        return 1;
      }
    }
  } else {
    for (const t of willRemove) {
      removed.push(relative(cwd, t.path) || t.path);
      keptOverall.push(...t.kept);
    }
  }

  const result: CleanResult = {
    cwd,
    targets,
    removed,
    kept: keptOverall,
    total_bytes: totalBytes,
    dry_run: dryRun,
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const prefix = dryRun ? 'Would remove' : 'Removed';
    logger.info(`${prefix} ${removed.length} path(s), ${formatBytes(totalBytes)} freed.`);
  }
  return 0;
}

function isInside(base: string, target: string): boolean {
  const baseAbs = isAbsolute(base) ? base : resolve(base);
  const targetAbs = isAbsolute(target) ? target : resolve(target);
  const rel = relative(baseAbs, targetAbs);
  if (rel === '') return true;
  return !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

async function dirBytes(path: string): Promise<number> {
  let total = 0;
  try {
    const s = await stat(path);
    if (s.isFile()) return s.size;
    if (!s.isDirectory()) return 0;
  } catch {
    return 0;
  }
  const entries = await readdir(path, { withFileTypes: true });
  for (const e of entries) {
    const child = join(path, e.name);
    if (e.isDirectory()) {
      total += await dirBytes(child);
    } else {
      try {
        const s = await stat(child);
        total += s.size;
      } catch {
        // entry may have vanished mid-scan
      }
    }
  }
  return total;
}

// Implement `--keep` by moving each kept path aside, nuking the parent dir,
// then restoring. Cheaper than a recursive copy and avoids the partial-state
// hazards of "delete every entry except…" loops.
async function removeWithKeep(targetDir: string, keptAbsPaths: string[]): Promise<void> {
  const stash = `${targetDir}.laurel-keep-${process.pid}-${Date.now()}`;
  await mkdir(stash, { recursive: true });
  const moved: Array<{ from: string; to: string }> = [];
  for (const abs of keptAbsPaths) {
    const rel = relative(targetDir, abs);
    const to = join(stash, rel);
    await mkdir(join(to, '..'), { recursive: true });
    await rename(abs, to);
    moved.push({ from: abs, to });
  }
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const m of moved) {
    await mkdir(join(m.from, '..'), { recursive: true });
    await rename(m.to, m.from);
  }
  await rm(stash, { recursive: true, force: true });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0] ?? 'KB';
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i] ?? unit;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // Non-interactive stdin (CI, pipes) without --yes is treated as "no"
    // to avoid an indefinite hang. Operators must pass --yes explicitly.
    process.stderr.write(
      'Refusing to delete in non-interactive context without --yes. Pass --yes to proceed.\n',
    );
    return false;
  }
  process.stdout.write(prompt);
  return await new Promise<boolean>((resolveFn) => {
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      const answer = chunk.trim().toLowerCase();
      resolveFn(answer === 'y' || answer === 'yes');
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
