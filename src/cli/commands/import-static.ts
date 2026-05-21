import {
  ON_CONFLICT_VALUES,
  type OnConflict,
  type StaticSiteSource,
  importStaticSiteMarkdown,
} from '~/static-site/import.ts';
import { logger } from '~/util/logger.ts';
import {
  CliUsageError,
  type CommandSpec,
  type ParsedCommand,
  formatCommandHelp,
  parseCommand,
} from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_HUGO_SPEC, IMPORT_JEKYLL_SPEC } from '../specs.ts';

export function runImportHugo(args: string[]): Promise<number> {
  return runImportStaticSite('hugo', IMPORT_HUGO_SPEC, args);
}

export function runImportJekyll(args: string[]): Promise<number> {
  return runImportStaticSite('jekyll', IMPORT_JEKYLL_SPEC, args);
}

export async function runImportStaticSite(
  source: StaticSiteSource,
  spec: CommandSpec,
  args: string[],
): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(spec, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(spec));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(spec));
    return 0;
  }

  const sourcePath = parsed.positionals[0];
  if (!sourcePath) {
    process.stderr.write('A source directory is required.\n\n');
    process.stderr.write(formatCommandHelp(spec));
    return 2;
  }

  const onConflict = parseOnConflict(parsed, spec);
  if (!onConflict) return 2;

  const dryRun = parsed.values['dry-run'] === true;
  const asJson = parsed.values.json === true;
  const cwd = process.cwd();
  try {
    const summary = await importStaticSiteMarkdown({
      cwd,
      source,
      sourcePath,
      onConflict,
      dryRun,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ ok: true, source, dryRun, summary })}\n`);
      return 0;
    }
    if (dryRun) {
      process.stdout.write(formatDryRunSummary(source, summary));
      return 0;
    }
    logger.info(
      `Imported ${summary.posts} ${source} post(s), wrote ${summary.redirects} redirect(s) from aliases`,
    );
    if (summary.skipped > 0 || summary.overwritten > 0 || summary.renamed > 0) {
      logger.info(
        `Conflicts: ${summary.skipped} skipped, ${summary.overwritten} overwritten, ${summary.renamed} renamed`,
      );
    }
    if (summary.unsupportedFrontmatter > 0) {
      logger.warn(
        `${summary.unsupportedFrontmatter} file(s) had an unsupported or unclosed frontmatter fence and were imported without remapping it.`,
      );
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function parseOnConflict(parsed: ParsedCommand, spec: CommandSpec): OnConflict | null {
  const raw = parsed.values['on-conflict'];
  if (typeof raw !== 'string') return 'skip';
  if (!(ON_CONFLICT_VALUES as readonly string[]).includes(raw)) {
    process.stderr.write(
      `Invalid --on-conflict value: ${raw}. Expected one of: ${ON_CONFLICT_VALUES.join(', ')}.\n\n`,
    );
    process.stderr.write(formatCommandHelp(spec));
    return null;
  }
  return raw as OnConflict;
}

function formatDryRunSummary(
  source: StaticSiteSource,
  summary: Awaited<ReturnType<typeof importStaticSiteMarkdown>>,
): string {
  const rows = [
    ['Posts to import', summary.posts],
    ['Redirects from aliases', summary.redirects],
    ['Unsupported frontmatter', summary.unsupportedFrontmatter],
    ['Conflicts (would skip)', summary.skipped],
    ['Conflicts (would overwrite)', summary.overwritten],
    ['Conflicts (would rename)', summary.renamed],
  ] as const;
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => String(value).length));
  const lines = [
    `Dry run (${source}): no files written. Source posts directory: ${summary.sourceDir}`,
    '',
  ];
  for (const [label, value] of rows) {
    lines.push(`  ${label.padEnd(labelWidth)}  ${String(value).padStart(valueWidth)}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
