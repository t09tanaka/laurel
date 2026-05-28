import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { CACHE_SPEC } from '../specs.ts';

interface CacheStats {
  path: string;
  exists: boolean;
  files: number;
  bytes: number;
}

export async function runCache(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CACHE_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CACHE_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CACHE_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  const cwd = process.cwd();
  const cacheDir = resolve(cwd, '.nectar/cache');
  const asJson = parsed.values.json === true;

  if (sub === 'dir') {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ path: cacheDir, exists: existsSync(cacheDir) })}\n`);
    } else {
      process.stdout.write(`${cacheDir}\n`);
    }
    return 0;
  }

  if (sub === 'stats') {
    const stats = await cacheStats(cacheDir);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    } else if (!stats.exists) {
      process.stdout.write(`No cache directory found at ${relative(cwd, cacheDir)}.\n`);
    } else {
      process.stdout.write(
        `${relative(cwd, cacheDir)}: ${stats.files} file(s), ${formatBytes(stats.bytes)}\n`,
      );
    }
    return 0;
  }

  if (sub === 'clean') {
    const dryRun = parsed.values['dry-run'] === true;
    const stats = await cacheStats(cacheDir);
    if (dryRun || !stats.exists) {
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ ...stats, removed: false, dry_run: dryRun })}\n`);
      } else if (!stats.exists) {
        process.stdout.write('No cache directory to remove.\n');
      } else {
        process.stdout.write(
          `Would remove ${relative(cwd, cacheDir)} (${stats.files} file(s), ${formatBytes(stats.bytes)}).\n`,
        );
      }
      return 0;
    }
    await rm(cacheDir, { recursive: true, force: true });
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ ...stats, removed: true, dry_run: false })}\n`);
    } else {
      logger.info(`Removed ${relative(cwd, cacheDir)} (${formatBytes(stats.bytes)}).`);
    }
    return 0;
  }

  process.stderr.write(
    `Unknown subcommand: ${sub ?? ''}. Expected \`dir\`, \`stats\`, or \`clean\`.\n`,
  );
  return 2;
}

async function cacheStats(path: string): Promise<CacheStats> {
  if (!existsSync(path)) return { path, exists: false, files: 0, bytes: 0 };
  const scanned = await scan(path);
  return { path, exists: true, files: scanned.files, bytes: scanned.bytes };
}

async function scan(path: string): Promise<{ files: number; bytes: number }> {
  const st = await stat(path);
  if (st.isFile()) return { files: 1, bytes: st.size };
  if (!st.isDirectory()) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await scan(child);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      const childStat = await stat(child);
      files += 1;
      bytes += childStat.size;
    }
  }
  return { files, bytes };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
