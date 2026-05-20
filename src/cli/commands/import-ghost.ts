import { relative } from 'node:path';
import { ON_CONFLICT_VALUES, type OnConflict, importGhostExport } from '~/ghost/import.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_GHOST_SPEC } from '../specs.ts';

export async function runImportGhost(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(IMPORT_GHOST_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 0;
  }

  const file = parsed.positionals[0];
  if (!file) {
    process.stderr.write('A file path is required.\n\n');
    process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 2;
  }

  const rawOnConflict = parsed.values['on-conflict'];
  let onConflict: OnConflict = 'skip';
  if (typeof rawOnConflict === 'string') {
    if (!(ON_CONFLICT_VALUES as readonly string[]).includes(rawOnConflict)) {
      process.stderr.write(
        `Invalid --on-conflict value: ${rawOnConflict}. Expected one of: ${ON_CONFLICT_VALUES.join(', ')}.\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    onConflict = rawOnConflict as OnConflict;
  }

  const rawAssets = parsed.values.assets;
  const assetsDir = typeof rawAssets === 'string' ? rawAssets : undefined;

  const rawOutput = parsed.values.output;
  const outputDir = typeof rawOutput === 'string' ? rawOutput : undefined;

  const downloadImages = parsed.values['download-images'] === true;

  const rawMaxImageSize = parsed.values['max-image-size'];
  let maxImageSizeBytes: number | undefined;
  if (typeof rawMaxImageSize === 'string') {
    const parsedSize = parseSizeSpec(rawMaxImageSize);
    if (parsedSize === null) {
      process.stderr.write(
        `Invalid --max-image-size value: ${rawMaxImageSize}. Expected a non-negative number with optional KB/MB/GB suffix (e.g. 10MB, 1GB, 0 to disable).\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    maxImageSizeBytes = parsedSize;
  }

  const rawSourceUrl = parsed.values['source-url'];
  const sourceUrl = typeof rawSourceUrl === 'string' ? rawSourceUrl : undefined;

  const dryRun = parsed.values['dry-run'] === true;

  const rawMaxSize = parsed.values['max-size'];
  let maxFileSizeBytes: number | undefined;
  if (typeof rawMaxSize === 'string') {
    const parsedSize = parseSizeSpec(rawMaxSize);
    if (parsedSize === null) {
      process.stderr.write(
        `Invalid --max-size value: ${rawMaxSize}. Expected a non-negative number with optional KB/MB/GB suffix (e.g. 256MB, 1GB, 0 to disable).\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    maxFileSizeBytes = parsedSize;
  }

  const keepCodeInjection = parsed.values['keep-code-injection'] === true;
  const asJson = parsed.values.json === true;

  const cwd = process.cwd();
  try {
    const summary = await importGhostExport({
      cwd,
      file,
      onConflict,
      assetsDir,
      downloadImages,
      maxImageSizeBytes,
      sourceUrl,
      dryRun,
      maxFileSizeBytes,
      keepCodeInjection,
      outputDir,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ ok: true, dryRun, summary })}\n`);
      return 0;
    }
    if (dryRun) {
      process.stdout.write(formatDryRunSummary(summary, { cwd, downloadImages, outputDir }));
      return 0;
    }
    logger.info(
      `Imported ${summary.posts} posts, ${summary.pages} pages, ${summary.tags} tags, ${summary.authors} authors`,
    );
    if (summary.assetsCopied > 0) {
      logger.info(`Copied ${summary.assetsCopied} asset files into ${outputDir ?? 'content/'}`);
    }
    if (summary.imagesDownloaded > 0 || summary.imagesFailed > 0) {
      logger.info(
        `Downloaded ${summary.imagesDownloaded} remote images into content/images/ (${summary.imagesFailed} failed)`,
      );
    }
    if (summary.skipped > 0 || summary.overwritten > 0 || summary.renamed > 0) {
      logger.info(
        `Conflicts: ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.renamed} renamed`,
      );
    }
    if (summary.slugCollisions > 0) {
      logger.warn(
        `Detected ${summary.slugCollisions} intra-export slug collision(s). The first entity to claim each path was kept; later duplicates were refused. Audit the export for tampered or malformed slug data.`,
      );
    }
    if (summary.redirectsImported > 0 || summary.slugRedirects > 0) {
      logger.info(
        `Wrote migration/redirects/ snippets (${summary.redirectsImported} custom, ${summary.slugRedirects} from slug changes): _redirects, vercel.json, nginx.conf`,
      );
    }
    if (summary.codeInjectionSkipped > 0 && !keepCodeInjection) {
      logger.info(
        `Skipped code injection in ${summary.codeInjectionSkipped} posts. Re-run with --keep-code-injection to import them.`,
      );
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

interface DryRunSummaryRow {
  label: string;
  value: number;
  note?: string;
}

function formatDryRunSummary(
  summary: Awaited<ReturnType<typeof importGhostExport>>,
  ctx: { cwd: string; downloadImages: boolean; outputDir?: string },
): string {
  const rows: DryRunSummaryRow[] = [
    { label: 'Posts to import', value: summary.posts },
    { label: 'Pages to import', value: summary.pages },
    {
      label: 'Drafts (included above)',
      value: summary.drafts,
      note: 'imported alongside published; pass --on-conflict to control writes',
    },
    {
      label: 'Status-filtered',
      value: summary.statusFiltered,
      note: 'status not in {published, draft}; not imported',
    },
    {
      label: 'Empty bodies',
      value: summary.bodiesEmpty,
      note: 'lexical/mobiledoc rendered to empty markdown',
    },
    { label: 'Tags', value: summary.tags },
    { label: 'Authors', value: summary.authors },
    {
      label: 'Assets to copy',
      value: summary.assetsCopied,
      note: 'images/files/media into the target output',
    },
    {
      label: 'Conflicts (would skip)',
      value: summary.skipped,
      note: 'existing files; default policy is skip',
    },
    {
      label: 'Conflicts (would overwrite)',
      value: summary.overwritten,
    },
    {
      label: 'Conflicts (would rename)',
      value: summary.renamed,
    },
    {
      label: 'Slug collisions (in export)',
      value: summary.slugCollisions,
      note: 'duplicate slugs within the same export; refused regardless of --on-conflict',
    },
    {
      label: 'Redirects (custom)',
      value: summary.redirectsImported,
      note: 'from content/data/redirects.json',
    },
    {
      label: 'Redirects (slug changes)',
      value: summary.slugRedirects,
      note: 'auto-generated for slugs rewritten by safeSlug',
    },
    {
      label: 'Code injection skipped',
      value: summary.codeInjectionSkipped,
      note: 'posts whose codeinjection_head/foot were dropped; pass --keep-code-injection to import',
    },
  ];
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const valueWidth = Math.max(...rows.map((r) => String(r.value).length));
  const target = ctx.outputDir ?? 'content/';
  const lines = [
    'Dry run: no files written. Summary of what would land:',
    `Target output: ${target}`,
    '',
  ];
  for (const r of rows) {
    const padLabel = r.label.padEnd(labelWidth);
    const padValue = String(r.value).padStart(valueWidth);
    lines.push(`  ${padLabel}  ${padValue}${r.note ? `   (${r.note})` : ''}`);
  }
  if (ctx.downloadImages) {
    lines.push('');
    lines.push('  Note: --download-images is set, but no images were fetched in dry-run mode.');
  }
  if (summary.redirectsImported > 0 || summary.slugRedirects > 0) {
    lines.push('');
    lines.push(
      '  Note: redirect snippets (_redirects, vercel.json, nginx.conf) would land under the target migration/redirects/.',
    );
  }
  if (summary.plannedPaths.length > 0) {
    lines.push('');
    lines.push(`  Planned paths (${summary.plannedPaths.length}):`);
    for (const path of summary.plannedPaths) {
      const rel = relative(ctx.cwd, path);
      lines.push(`    ${rel.startsWith('..') ? path : rel}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// Parse a human-readable size spec (e.g. "256MB", "1GB", "512KB", "1024") into
// a non-negative byte count. Returns null when the input cannot be interpreted
// so the caller can surface a usage error. Accepts a decimal number with an
// optional B/KB/MB/GB/TB suffix using powers of 1024 to match how Ghost
// exports and operating systems typically report file sizes. `0` is allowed
// and means "disable the cap" (callers translate that into skipping the check).
export function parseSizeSpec(input: string): number | null {
  const s = input.trim();
  if (s.length === 0) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?b)?$/i.exec(s);
  if (!m) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = (m[2] ?? 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };
  const mult = multipliers[unit];
  if (mult === undefined) return null;
  return Math.floor(value * mult);
}
