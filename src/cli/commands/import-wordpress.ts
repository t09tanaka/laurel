import { logger } from '~/util/logger.ts';
import { ON_CONFLICT_VALUES, type OnConflict, importWordPressExport } from '~/wordpress/import.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_WORDPRESS_SPEC } from '../specs.ts';

export async function runImportWordPress(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(IMPORT_WORDPRESS_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_WORDPRESS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(IMPORT_WORDPRESS_SPEC));
    return 0;
  }

  const file = parsed.positionals[0];
  if (!file) {
    process.stderr.write('A file path is required.\n\n');
    process.stderr.write(formatCommandHelp(IMPORT_WORDPRESS_SPEC));
    return 2;
  }

  const rawOnConflict = parsed.values['on-conflict'];
  let onConflict: OnConflict = 'skip';
  if (typeof rawOnConflict === 'string') {
    if (!(ON_CONFLICT_VALUES as readonly string[]).includes(rawOnConflict)) {
      process.stderr.write(
        `Invalid --on-conflict value: ${rawOnConflict}. Expected one of: ${ON_CONFLICT_VALUES.join(', ')}.\n\n`,
      );
      process.stderr.write(formatCommandHelp(IMPORT_WORDPRESS_SPEC));
      return 2;
    }
    onConflict = rawOnConflict as OnConflict;
  }

  const dryRun = parsed.values['dry-run'] === true;
  const cwd = process.cwd();
  try {
    const summary = await importWordPressExport({ cwd, file, onConflict, dryRun });
    if (dryRun) {
      process.stdout.write(formatDryRunSummary(summary));
      return 0;
    }
    logger.info(
      `Imported ${summary.posts} posts, ${summary.pages} pages, ${summary.tags} tags, ${summary.authors} authors`,
    );
    if (summary.skipped > 0 || summary.overwritten > 0 || summary.renamed > 0) {
      logger.info(
        `Conflicts: ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.renamed} renamed`,
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

function formatDryRunSummary(summary: Awaited<ReturnType<typeof importWordPressExport>>): string {
  const rows: DryRunSummaryRow[] = [
    { label: 'Posts to import', value: summary.posts },
    { label: 'Pages to import', value: summary.pages },
    {
      label: 'Drafts (included above)',
      value: summary.drafts,
      note: 'imported alongside published; pass --on-conflict to control writes',
    },
    {
      label: 'Type-filtered',
      value: summary.typeFiltered,
      note: 'post_type not in {post, page} (e.g. attachment, nav_menu_item)',
    },
    {
      label: 'Status-filtered',
      value: summary.statusFiltered,
      note: 'wp:status not in {publish, draft}',
    },
    {
      label: 'Empty bodies',
      value: summary.bodiesEmpty,
      note: 'content:encoded was empty after CDATA unwrap',
    },
    { label: 'Tags', value: summary.tags },
    { label: 'Authors', value: summary.authors },
    {
      label: 'Conflicts (would skip)',
      value: summary.skipped,
      note: 'existing files; default policy is skip',
    },
    { label: 'Conflicts (would overwrite)', value: summary.overwritten },
    { label: 'Conflicts (would rename)', value: summary.renamed },
  ];
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const valueWidth = Math.max(...rows.map((r) => String(r.value).length));
  const lines = ['Dry run: no files written. Summary of what would land:', ''];
  for (const r of rows) {
    const padLabel = r.label.padEnd(labelWidth);
    const padValue = String(r.value).padStart(valueWidth);
    lines.push(`  ${padLabel}  ${padValue}${r.note ? `   (${r.note})` : ''}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
