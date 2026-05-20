import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { TAGS_SPEC } from '../specs.ts';

interface TagRow {
  slug: string;
  name: string;
  post_count: number;
}

export async function runTags(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(TAGS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(TAGS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(TAGS_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Currently only \`tags list\` is supported.\n`,
    );
    return 2;
  }

  const orphanedOnly = parsed.values.orphaned === true || parsed.values.unused === true;
  const asJson = parsed.values.json === true;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const cwd = process.cwd();

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config });

    const rows: TagRow[] = graph.tags
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        post_count: graph.postsByTag.get(t.slug)?.length ?? 0,
      }))
      .filter((row) => (orphanedOnly ? row.post_count === 0 : true))
      .sort((a, b) => {
        if (b.post_count !== a.post_count) return b.post_count - a.post_count;
        return a.slug.localeCompare(b.slug);
      });

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ count: rows.length, tags: rows }, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write(orphanedOnly ? 'No orphaned tags found.\n' : 'No tags defined.\n');
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function renderTable(rows: TagRow[]): string {
  const slugWidth = Math.max(4, ...rows.map((r) => r.slug.length));
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  const lines: string[] = [];
  lines.push(`${pad('slug', slugWidth)}  ${pad('name', nameWidth)}  posts`);
  lines.push(`${'-'.repeat(slugWidth)}  ${'-'.repeat(nameWidth)}  -----`);
  for (const r of rows) {
    lines.push(`${pad(r.slug, slugWidth)}  ${pad(r.name, nameWidth)}  ${r.post_count}`);
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}
