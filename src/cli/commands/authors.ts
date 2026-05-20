import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { AUTHORS_SPEC } from '../specs.ts';

interface AuthorRow {
  slug: string;
  name: string;
  post_count: number;
}

export async function runAuthors(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(AUTHORS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(AUTHORS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(AUTHORS_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  if (sub !== 'list') {
    process.stderr.write(`Unknown subcommand: ${sub ?? ''}. Expected \`list\`.\n`);
    return 2;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const orphanedOnly = parsed.values.orphaned === true;
  const asJson = parsed.values.json === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config });

    const rows: AuthorRow[] = graph.authors
      .map((author) => ({
        slug: author.slug,
        name: author.name,
        post_count: author.count.posts,
      }))
      .filter((row) => (orphanedOnly ? row.post_count === 0 : true))
      .sort((a, b) => {
        if (b.post_count !== a.post_count) return b.post_count - a.post_count;
        return a.slug.localeCompare(b.slug);
      });

    if (asJson) {
      process.stdout.write(`${JSON.stringify({ count: rows.length, authors: rows }, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write(orphanedOnly ? 'No orphaned authors found.\n' : 'No authors defined.\n');
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function renderTable(rows: AuthorRow[]): string {
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
