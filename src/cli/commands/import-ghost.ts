import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  ON_CONFLICT_VALUES,
  type OnConflict,
  importGhostExport,
  parseImportSinceTimestamp,
} from '~/ghost/import.ts';
import { logger } from '~/util/logger.ts';
import { t } from '../i18n/index.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_GHOST_SPEC } from '../specs.ts';
import { readStdinText } from '../stdin.ts';

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
    process.stderr.write(`${t('importGhost.requiredFile')}\n\n`);
    process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 2;
  }

  const rawOnConflict = parsed.values['on-conflict'];
  let onConflict: OnConflict = 'skip';
  if (typeof rawOnConflict === 'string') {
    if (!(ON_CONFLICT_VALUES as readonly string[]).includes(rawOnConflict)) {
      process.stderr.write(
        `${t('importGhost.invalidOnConflict', {
          value: rawOnConflict,
          values: ON_CONFLICT_VALUES.join(', '),
        })}\n\n`,
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
  const downloadSettingsImages = parsed.values['no-download-settings-images'] !== true;

  const rawMaxImageSize = parsed.values['max-image-size'];
  let maxImageSizeBytes: number | undefined;
  if (typeof rawMaxImageSize === 'string') {
    const parsedSize = parseSizeSpec(rawMaxImageSize);
    if (parsedSize === null) {
      process.stderr.write(
        `${t('importGhost.invalidMaxImageSize', { value: rawMaxImageSize })}\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    maxImageSizeBytes = parsedSize;
  }

  const rawSourceUrl = parsed.values['source-url'];
  const sourceUrl = typeof rawSourceUrl === 'string' ? rawSourceUrl : undefined;

  const altFromFilename = parsed.values['alt-from-filename'] === true;

  const dryRun = parsed.values['dry-run'] === true;

  const rawMaxSize = parsed.values['max-size'];
  let maxFileSizeBytes: number | undefined;
  if (typeof rawMaxSize === 'string') {
    const parsedSize = parseSizeSpec(rawMaxSize);
    if (parsedSize === null) {
      process.stderr.write(`${t('importGhost.invalidMaxSize', { value: rawMaxSize })}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    maxFileSizeBytes = parsedSize;
  }

  const rawMaxPostHtmlSize = parsed.values['max-post-html-size'];
  let maxPostHtmlSizeBytes: number | undefined;
  if (typeof rawMaxPostHtmlSize === 'string') {
    const parsedSize = parseSizeSpec(rawMaxPostHtmlSize);
    if (parsedSize === null) {
      process.stderr.write(
        `${t('importGhost.invalidMaxPostHtmlSize', { value: rawMaxPostHtmlSize })}\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    maxPostHtmlSizeBytes = parsedSize;
  }

  const keepCodeInjection = parsed.values['keep-code-injection'] === true;
  const keepHtml = parsed.values['keep-html'] === true;
  const includeDrafts = parsed.values['include-drafts'] === true;
  const includePages = parsed.values['include-pages'] === true;
  const rawOnlyTags = parsed.values['only-tags'];
  const onlyTags = typeof rawOnlyTags === 'string' ? parseOnlyTags(rawOnlyTags) : undefined;
  if (onlyTags && onlyTags.length === 0) {
    process.stderr.write(`${t('importGhost.invalidOnlyTags', { value: rawOnlyTags })}\n\n`);
    process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
    return 2;
  }
  const rawSince = parsed.values.since;
  const since = typeof rawSince === 'string' ? rawSince : undefined;
  if (since) {
    try {
      parseImportSinceTimestamp(since);
    } catch (err) {
      const message = err instanceof Error ? err.message : `Invalid --since value: ${since}`;
      process.stderr.write(`${message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
  }
  const asJson = parsed.values.json === true;

  const cwd = process.cwd();
  let stdinTempRoot: string | undefined;
  let inputFile = file;
  try {
    if (file === '-') {
      const raw = await readStdinText('Pipe a Ghost JSON export into `laurel import-ghost -`.');
      if (raw.trim().length === 0) {
        process.stderr.write('No Ghost export JSON was read from stdin.\n\n');
        process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
        return 2;
      }
      stdinTempRoot = await mkdtemp(join(tmpdir(), 'laurel-import-ghost-stdin-'));
      inputFile = join(stdinTempRoot, 'stdin.json');
      await writeFile(inputFile, raw, 'utf8');
    }

    const summary = await importGhostExport({
      cwd,
      file: inputFile,
      onConflict,
      assetsDir,
      downloadImages,
      downloadSettingsImages,
      maxImageSizeBytes,
      sourceUrl,
      altFromFilename,
      dryRun,
      maxFileSizeBytes,
      maxPostHtmlSizeBytes,
      keepCodeInjection,
      keepHtml,
      outputDir,
      includeDrafts,
      includePages,
      onlyTags,
      since,
      onProgress:
        asJson || dryRun
          ? undefined
          : (event) => {
              if (event.type === 'posts') {
                logger.info(
                  t('importGhost.progressPosts', {
                    processed: event.processedPosts,
                    total: event.totalPosts,
                  }),
                );
              }
            },
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
      t('importGhost.imported', {
        posts: summary.posts,
        pages: summary.pages,
        tags: summary.tags,
        authors: summary.authors,
      }),
    );
    if (summary.assetsCopied > 0) {
      logger.info(
        t('importGhost.assetsCopied', {
          count: summary.assetsCopied,
          target: outputDir ?? 'content/',
        }),
      );
    }
    if (summary.imagesDownloaded > 0 || summary.imagesFailed > 0) {
      logger.info(
        t('importGhost.downloadedImages', {
          downloaded: summary.imagesDownloaded,
          failed: summary.imagesFailed,
        }),
      );
    }
    if (summary.settingsImagesDownloaded > 0 || summary.settingsImagesFailed > 0) {
      logger.info(
        t('importGhost.settingsImages', {
          downloaded: summary.settingsImagesDownloaded,
          failed: summary.settingsImagesFailed,
        }),
      );
    }
    if (summary.altBackfilled > 0) {
      logger.info(t('importGhost.altBackfilled', { count: summary.altBackfilled }));
    }
    if (summary.skipped > 0 || summary.overwritten > 0 || summary.renamed > 0) {
      logger.info(
        t('importGhost.conflicts', {
          skipped: summary.skipped,
          overwritten: summary.overwritten,
          renamed: summary.renamed,
        }),
      );
    }
    if (hasFilteredItems(summary)) {
      logger.info(formatFilteredItems(summary));
    }
    if (summary.slugCollisions > 0) {
      logger.warn(t('importGhost.slugCollisions', { count: summary.slugCollisions }));
    }
    if (summary.redirectsImported > 0 || summary.slugRedirects > 0) {
      logger.info(
        t('importGhost.redirectsWritten', {
          custom: summary.redirectsImported,
          slugChanges: summary.slugRedirects,
        }),
      );
    }
    if (summary.codeInjectionSkipped > 0 && !keepCodeInjection) {
      logger.info(t('importGhost.codeInjectionSkipped', { count: summary.codeInjectionSkipped }));
    }
    if (summary.htmlPreserved > 0) {
      logger.info(t('importGhost.htmlPreserved', { count: summary.htmlPreserved }));
    }
    return 0;
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_GHOST_SPEC));
      return 2;
    }
    reportError(err, cwd);
    return 1;
  } finally {
    if (stdinTempRoot) {
      await rm(stdinTempRoot, { recursive: true, force: true });
    }
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
    { label: t('importGhost.dryRun.posts'), value: summary.posts },
    { label: t('importGhost.dryRun.pages'), value: summary.pages },
    {
      label: t('importGhost.dryRun.drafts'),
      value: summary.drafts,
      note: 'imported alongside published; pass --on-conflict to control writes',
    },
    {
      label: t('importGhost.dryRun.statusFiltered'),
      value: summary.statusFiltered,
      note: 'status not in {published, draft}; not imported',
    },
    {
      label: t('importGhost.dryRun.draftsFiltered'),
      value: summary.draftsFiltered,
      note: 'partial import without --include-drafts',
    },
    {
      label: t('importGhost.dryRun.pagesFiltered'),
      value: summary.pagesFiltered,
      note: 'partial import without --include-pages',
    },
    {
      label: t('importGhost.dryRun.tagFiltered'),
      value: summary.tagFiltered,
      note: 'post tags did not match --only-tags',
    },
    {
      label: t('importGhost.dryRun.dateFiltered'),
      value: summary.dateFiltered,
      note: 'published_at/created_at before --since or unavailable',
    },
    {
      label: t('importGhost.dryRun.emptyBodies'),
      value: summary.bodiesEmpty,
      note: 'body rendered empty or Turndown fell back safely',
    },
    {
      label: t('importGhost.dryRun.altBackfilled'),
      value: summary.altBackfilled,
      note: 'empty image alt generated from filename (--alt-from-filename)',
    },
    { label: t('importGhost.dryRun.tags'), value: summary.tags },
    { label: t('importGhost.dryRun.authors'), value: summary.authors },
    {
      label: t('importGhost.dryRun.assets'),
      value: summary.assetsCopied,
      note: 'images/files/media into the target output',
    },
    {
      label: t('importGhost.dryRun.conflictsSkip'),
      value: summary.skipped,
      note: 'existing files; default policy is skip',
    },
    {
      label: t('importGhost.dryRun.conflictsOverwrite'),
      value: summary.overwritten,
    },
    {
      label: t('importGhost.dryRun.conflictsRename'),
      value: summary.renamed,
    },
    {
      label: t('importGhost.dryRun.slugCollisions'),
      value: summary.slugCollisions,
      note: 'duplicate slugs within the same export; refused regardless of --on-conflict',
    },
    {
      label: t('importGhost.dryRun.redirectsCustom'),
      value: summary.redirectsImported,
      note: 'from content/data/redirects.json',
    },
    {
      label: t('importGhost.dryRun.redirectsSlugChanges'),
      value: summary.slugRedirects,
      note: 'auto-generated for slugs rewritten by safeSlug',
    },
    {
      label: t('importGhost.dryRun.codeInjectionSkipped'),
      value: summary.codeInjectionSkipped,
      note: 'posts whose codeinjection_head/foot were dropped; pass --keep-code-injection to import',
    },
    {
      label: t('importGhost.dryRun.htmlPreserved'),
      value: summary.htmlPreserved,
      note: 'sibling .md.html files; pass --keep-html to write them',
    },
  ];
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const valueWidth = Math.max(...rows.map((r) => String(r.value).length));
  const target = ctx.outputDir ?? 'content/';
  const lines = [t('importGhost.dryRun.header'), t('importGhost.dryRun.target', { target }), ''];
  for (const r of rows) {
    const padLabel = r.label.padEnd(labelWidth);
    const padValue = String(r.value).padStart(valueWidth);
    lines.push(`  ${padLabel}  ${padValue}${r.note ? `   (${r.note})` : ''}`);
  }
  if (ctx.downloadImages) {
    lines.push('');
    lines.push(`  ${t('importGhost.dryRun.imagesNote')}`);
  }
  if (summary.redirectsImported > 0 || summary.slugRedirects > 0) {
    lines.push('');
    lines.push(`  ${t('importGhost.dryRun.redirectsNote')}`);
  }
  if (summary.plannedPaths.length > 0) {
    lines.push('');
    lines.push(`  ${t('importGhost.dryRun.paths', { count: summary.plannedPaths.length })}`);
    for (const path of summary.plannedPaths) {
      const rel = relative(ctx.cwd, path);
      lines.push(`    ${rel.startsWith('..') ? path : rel}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseOnlyTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of input.split(',')) {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function hasFilteredItems(summary: Awaited<ReturnType<typeof importGhostExport>>): boolean {
  return (
    summary.statusFiltered > 0 ||
    summary.draftsFiltered > 0 ||
    summary.pagesFiltered > 0 ||
    summary.tagFiltered > 0 ||
    summary.dateFiltered > 0
  );
}

function formatFilteredItems(summary: Awaited<ReturnType<typeof importGhostExport>>): string {
  return t('importGhost.filteredItems', {
    total:
      summary.statusFiltered +
      summary.draftsFiltered +
      summary.pagesFiltered +
      summary.tagFiltered +
      summary.dateFiltered,
    status: summary.statusFiltered,
    drafts: summary.draftsFiltered,
    pages: summary.pagesFiltered,
    tag: summary.tagFiltered,
    date: summary.dateFiltered,
  });
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
  const numeric = m[1];
  if (numeric === undefined) return null;
  const value = Number.parseFloat(numeric);
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
