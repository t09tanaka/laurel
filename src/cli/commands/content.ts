import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import type { Page, Post } from '~/content/model.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { CONTENT_SPEC } from '../specs.ts';

type Kind = 'posts' | 'pages';

interface ContentRow {
  slug: string;
  title: string;
  date: string;
  status: string;
  tags: string[];
  authors: string[];
  url: string;
}

export async function runContent(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CONTENT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CONTENT_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CONTENT_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  if (sub !== 'list') {
    process.stderr.write(
      `Unknown subcommand: ${sub ?? ''}. Currently only \`content list\` is supported.\n`,
    );
    return 2;
  }

  const kindRaw = typeof parsed.values.kind === 'string' ? parsed.values.kind : 'posts';
  if (kindRaw !== 'posts' && kindRaw !== 'pages') {
    process.stderr.write(`Invalid --kind value: ${kindRaw} (expected "posts" or "pages")\n`);
    return 2;
  }
  const kind: Kind = kindRaw;
  const includeDrafts = parsed.values.draft === true;
  const tagFilter = typeof parsed.values.tag === 'string' ? parsed.values.tag : undefined;
  const authorFilter = typeof parsed.values.author === 'string' ? parsed.values.author : undefined;
  const asJson = parsed.values.json === true;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const cwd = process.cwd();

  try {
    const config = await loadConfig({ cwd, configPath });
    const graph = await loadContent({ cwd, config, includeDrafts });

    const items = kind === 'posts' ? graph.posts : graph.pages;
    const rows = items
      .filter((item) => (tagFilter ? hasTag(item, tagFilter) : true))
      .filter((item) => (authorFilter ? hasAuthor(item, authorFilter) : true))
      .map(toRow);

    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ kind, count: rows.length, items: rows }, null, 2)}\n`,
      );
    } else if (rows.length === 0) {
      process.stdout.write(`No ${kind} match the given filters.\n`);
    } else {
      process.stdout.write(renderTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function hasTag(item: Post | Page, slug: string): boolean {
  return item.tags.some((t) => t.slug === slug);
}

function hasAuthor(item: Post | Page, slug: string): boolean {
  return item.authors.some((a) => a.slug === slug);
}

function toRow(item: Post | Page): ContentRow {
  return {
    slug: item.slug,
    title: item.title,
    date: item.published_at,
    status: item.status,
    tags: item.tags.map((t) => t.slug),
    authors: item.authors.map((a) => a.slug),
    url: item.url,
  };
}

function renderTable(rows: ContentRow[]): string {
  const headers = ['slug', 'title', 'date', 'status'];
  const widths = headers.map((h) => h.length);
  for (const r of rows) {
    widths[0] = Math.max(widths[0] ?? 0, r.slug.length);
    widths[1] = Math.max(widths[1] ?? 0, Math.min(r.title.length, 50));
    widths[2] = Math.max(widths[2] ?? 0, r.date.length);
    widths[3] = Math.max(widths[3] ?? 0, r.status.length);
  }
  const lines: string[] = [];
  lines.push(
    `${pad(headers[0] ?? '', widths[0] ?? 0)}  ${pad(headers[1] ?? '', widths[1] ?? 0)}  ${pad(headers[2] ?? '', widths[2] ?? 0)}  ${pad(headers[3] ?? '', widths[3] ?? 0)}`,
  );
  lines.push(
    `${'-'.repeat(widths[0] ?? 0)}  ${'-'.repeat(widths[1] ?? 0)}  ${'-'.repeat(widths[2] ?? 0)}  ${'-'.repeat(widths[3] ?? 0)}`,
  );
  for (const r of rows) {
    const title = r.title.length > 50 ? `${r.title.slice(0, 47)}…` : r.title;
    lines.push(
      `${pad(r.slug, widths[0] ?? 0)}  ${pad(title, widths[1] ?? 0)}  ${pad(r.date, widths[2] ?? 0)}  ${pad(r.status, widths[3] ?? 0)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}
