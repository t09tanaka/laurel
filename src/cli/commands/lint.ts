import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';
import type { Page, Post } from '~/content/model.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { LINT_SPEC } from '../specs.ts';

type Severity = 'error' | 'warn';

interface Finding {
  rule: string;
  severity: Severity;
  file: string;
  message: string;
}

const DEFAULT_MAX_TITLE = 70;

export async function runLint(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(LINT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(LINT_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(LINT_SPEC));
    return 0;
  }

  const asJson = parsed.values.json === true;
  const strict = parsed.values.strict === true;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  let maxTitle = DEFAULT_MAX_TITLE;
  const rawMax = parsed.values['max-title-length'];
  if (typeof rawMax === 'string') {
    const n = Number.parseInt(rawMax, 10);
    if (!Number.isFinite(n) || n < 1) {
      process.stderr.write(`Invalid --max-title-length: ${rawMax}. Expected a positive integer.\n`);
      return 2;
    }
    maxTitle = n;
  }

  const cwd = process.cwd();
  let findings: Finding[] = [];
  try {
    const config = await loadConfig({ cwd, configPath });
    findings = findings.concat(await scanRawFrontmatter(cwd, config));
    // The content loader rejects malformed frontmatter outright; a clean load
    // tells us the corpus parses, then we layer semantic checks on top.
    try {
      const graph = await loadContent({ cwd, config, includeDrafts: true });
      findings = findings.concat(
        lintTitles(graph.posts, maxTitle),
        lintTitles(graph.pages, maxTitle),
        lintFutureDates(graph.posts),
        lintDuplicateSlugs(graph.posts, 'posts'),
        lintDuplicateSlugs(graph.pages, 'pages'),
        lintBrokenLocalLinks(graph.posts, graph.pages),
        lintAltText(graph.posts, graph.pages),
      );
    } catch (err) {
      findings.push({
        rule: 'content-load',
        severity: 'error',
        file: '(content)',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ count: findings.length, errors, warnings, findings }, null, 2)}\n`,
    );
  } else if (findings.length === 0) {
    process.stdout.write('No findings.\n');
  } else {
    process.stdout.write(renderText(findings));
    process.stdout.write(`\n${errors} error(s), ${warnings} warning(s)\n`);
  }

  if (errors > 0) return 1;
  if (strict && warnings > 0) return 1;
  return 0;
}

function lintTitles(items: Array<Post | Page>, max: number): Finding[] {
  const out: Finding[] = [];
  for (const item of items) {
    if (!item.title || item.title.trim().length === 0) {
      out.push({
        rule: 'title-empty',
        severity: 'error',
        file: item.slug,
        message: 'title is empty',
      });
      continue;
    }
    if (item.title.length > max) {
      out.push({
        rule: 'title-too-long',
        severity: 'warn',
        file: item.slug,
        message: `title is ${item.title.length} chars (> ${max}); SEO surfaces will truncate`,
      });
    }
  }
  return out;
}

function lintFutureDates(posts: Post[]): Finding[] {
  const now = Date.now();
  const out: Finding[] = [];
  for (const post of posts) {
    if (!post.published_at) continue;
    const ts = Date.parse(post.published_at);
    if (Number.isFinite(ts) && ts > now && post.status === 'published') {
      out.push({
        rule: 'future-date',
        severity: 'warn',
        file: post.slug,
        message: `published_at is in the future (${post.published_at}); use status: scheduled if intentional`,
      });
    }
  }
  return out;
}

function lintDuplicateSlugs(items: Array<Post | Page>, kind: string): Finding[] {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.slug, (seen.get(item.slug) ?? 0) + 1);
  }
  const out: Finding[] = [];
  for (const [slug, count] of seen.entries()) {
    if (count > 1) {
      out.push({
        rule: 'duplicate-slug',
        severity: 'error',
        file: `${kind}/${slug}`,
        message: `slug appears ${count} times`,
      });
    }
  }
  return out;
}

// Cross-link sniff: `<a href="/foo/">` and `[label](./foo)` that don't resolve
// to a known post/page slug get flagged. Anchors (`#x`), mailto:, tel:, and
// absolute URLs are skipped.
function lintBrokenLocalLinks(posts: Post[], pages: Page[]): Finding[] {
  const known = new Set<string>();
  for (const item of [...posts, ...pages]) {
    if (item.url) known.add(stripQueryHash(item.url));
  }
  const out: Finding[] = [];
  for (const item of [...posts, ...pages]) {
    if (!item.html) continue;
    for (const href of extractHrefs(item.html)) {
      if (!isLocalNavHref(href)) continue;
      const path = stripQueryHash(ensureTrailingSlash(href));
      if (known.has(path)) continue;
      out.push({
        rule: 'broken-local-link',
        severity: 'warn',
        file: item.slug,
        message: `link target not found in content graph: ${href}`,
      });
    }
  }
  return out;
}

function lintAltText(posts: Post[], pages: Page[]): Finding[] {
  const out: Finding[] = [];
  for (const item of [...posts, ...pages]) {
    if (!item.html) continue;
    for (const tag of extractImgTags(item.html)) {
      if (/\salt\s*=\s*"[^"]*\S[^"]*"/.test(tag) || /\salt\s*=\s*'[^']*\S[^']*'/.test(tag)) {
        continue;
      }
      out.push({
        rule: 'img-missing-alt',
        severity: 'warn',
        file: item.slug,
        message: `<img> without non-empty alt: ${truncate(tag, 80)}`,
      });
    }
  }
  return out;
}

// Cheap frontmatter scan that runs before the structured loader so we can
// flag obviously malformed files (e.g. no closing `---`) even when the loader
// would refuse to ingest the whole corpus.
async function scanRawFrontmatter(cwd: string, config: NectarConfig): Promise<Finding[]> {
  const dirs = [
    { kind: 'posts', dir: config.content.posts_dir },
    { kind: 'pages', dir: config.content.pages_dir },
  ];
  const findings: Finding[] = [];
  for (const { kind, dir } of dirs) {
    const abs = isAbsolute(dir) ? dir : resolve(cwd, dir);
    if (!existsSync(abs)) continue;
    let entries: string[];
    try {
      entries = await readdir(abs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const file = join(abs, entry);
      let raw: string;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const result = quickFrontmatterCheck(raw);
      if (result === 'missing') {
        findings.push({
          rule: 'frontmatter-missing',
          severity: 'warn',
          file: `${kind}/${entry}`,
          message: 'no leading `---` frontmatter fence',
        });
      } else if (result === 'unclosed') {
        findings.push({
          rule: 'frontmatter-malformed',
          severity: 'error',
          file: `${kind}/${entry}`,
          message: 'frontmatter opens with `---` but is never closed',
        });
      }
    }
  }
  return findings;
}

type FrontmatterStatus = 'ok' | 'missing' | 'unclosed';

export function quickFrontmatterCheck(raw: string): FrontmatterStatus {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return 'missing';
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') return 'ok';
  }
  return 'unclosed';
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(re)) {
    const value = match[1] ?? match[2];
    if (value) out.push(value);
  }
  return out;
}

function extractImgTags(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    out.push(match[0]);
  }
  return out;
}

function isLocalNavHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  if (href.startsWith('//')) return false;
  return href.startsWith('/');
}

function ensureTrailingSlash(href: string): string {
  const [path] = href.split('#');
  const [pathOnly] = (path ?? '').split('?');
  if (!pathOnly) return href;
  if (pathOnly.endsWith('/')) return href;
  return href.replace(pathOnly, `${pathOnly}/`);
}

function stripQueryHash(href: string): string {
  const [withoutHash] = href.split('#');
  const [withoutQuery] = (withoutHash ?? '').split('?');
  return withoutQuery ?? href;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderText(findings: Finding[]): string {
  const lines: string[] = [];
  const sevWidth = 5;
  const ruleWidth = Math.max(4, ...findings.map((f) => f.rule.length));
  const fileWidth = Math.max(4, ...findings.map((f) => f.file.length));
  for (const f of findings) {
    lines.push(
      `${pad(f.severity, sevWidth)}  ${pad(f.rule, ruleWidth)}  ${pad(f.file, fileWidth)}  ${f.message}`,
    );
  }
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}
