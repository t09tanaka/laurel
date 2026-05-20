import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import {
  frontmatterStatusValues,
  frontmatterVisibilityValues,
} from '~/content/frontmatter-schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { scanGlob } from '~/util/fs.ts';

// Frontmatter schema for posts/pages. Centralised here so `nectar check
// --check-frontmatter` and downstream linting can share the field list
// without re-deriving it from the larger NectarConfig schema. Keep the rules
// intentionally narrow (required-ness + type sniff + enum values) so the
// check is cheap and the warnings are precise. Full content normalisation
// already happens inside `loadContent` — this just surfaces problems before
// the loader throws or silently coerces.

export interface FrontmatterIssue {
  file: string;
  line?: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
  code: string;
}

const POST_REQUIRED: readonly string[] = ['title'];
const PAGE_REQUIRED: readonly string[] = ['title'];
const STATUS_VALUES = new Set(frontmatterStatusValues);
const VISIBILITY_VALUES = new Set(frontmatterVisibilityValues);

export interface CheckFrontmatterOptions {
  cwd: string;
  config: NectarConfig;
}

export async function checkFrontmatterSchemas(
  opts: CheckFrontmatterOptions,
): Promise<FrontmatterIssue[]> {
  const issues: FrontmatterIssue[] = [];
  const postsDir = absolutise(opts.cwd, opts.config.content.posts_dir);
  const pagesDir = absolutise(opts.cwd, opts.config.content.pages_dir);

  const [postFiles, pageFiles] = await Promise.all([
    scanGlob('**/*.md', { cwd: postsDir }).catch(() => []),
    scanGlob('**/*.md', { cwd: pagesDir }).catch(() => []),
  ]);
  for (const rel of postFiles) {
    issues.push(...(await checkOne(join(postsDir, rel), 'post')));
  }
  for (const rel of pageFiles) {
    issues.push(...(await checkOne(join(pagesDir, rel), 'page')));
  }
  return issues;
}

async function checkOne(abs: string, kind: 'post' | 'page'): Promise<FrontmatterIssue[]> {
  let raw: string;
  try {
    raw = await readFile(abs, 'utf8');
  } catch (err) {
    return [
      {
        file: abs,
        field: '(file)',
        message: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
        code: 'frontmatter/read-failed',
      },
    ];
  }

  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(raw, { filePath: abs });
  } catch (err) {
    const line =
      err instanceof Error && 'line' in err ? (err as { line?: number }).line : undefined;
    const issue: FrontmatterIssue = {
      file: abs,
      field: '(yaml)',
      message: err instanceof Error ? err.message : String(err),
      severity: 'error',
      code: 'frontmatter/parse',
    };
    if (typeof line === 'number') issue.line = line;
    return [issue];
  }

  const out: FrontmatterIssue[] = [];
  const data = parsed.data;
  const required = kind === 'post' ? POST_REQUIRED : PAGE_REQUIRED;

  // Frontmatter block always starts at line 1 of the file. The exact line of
  // an offending key is hard to recover without re-walking the YAML AST, so
  // we report the file location and pinpoint the field name in the message.
  // Headline becomes `file.md:1` which is enough for editors to jump to the
  // top of the file.
  const headlineLine = 1;

  for (const f of required) {
    const value = data[f];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      out.push({
        file: abs,
        line: headlineLine,
        field: f,
        message: `Missing required field '${f}' in ${kind} frontmatter`,
        severity: 'error',
        code: 'frontmatter/required',
      });
    }
  }

  if (data.title !== undefined && typeof data.title !== 'string') {
    out.push({
      file: abs,
      line: headlineLine,
      field: 'title',
      message: `Field 'title' must be a string, got ${describeType(data.title)}`,
      severity: 'error',
      code: 'frontmatter/type',
    });
  }

  if (data.slug !== undefined) {
    if (typeof data.slug !== 'string') {
      out.push({
        file: abs,
        line: headlineLine,
        field: 'slug',
        message: `Field 'slug' must be a string, got ${describeType(data.slug)}`,
        severity: 'error',
        code: 'frontmatter/type',
      });
    } else if (!/^[a-z0-9][a-z0-9-]*$/.test(data.slug)) {
      out.push({
        file: abs,
        line: headlineLine,
        field: 'slug',
        message: `Field 'slug' should be a kebab-case URL token (lowercase + digits + dashes); got ${JSON.stringify(data.slug)}`,
        severity: 'warning',
        code: 'frontmatter/slug-format',
      });
    }
  }

  if (data.status !== undefined) {
    if (typeof data.status !== 'string' || !STATUS_VALUES.has(data.status)) {
      out.push({
        file: abs,
        line: headlineLine,
        field: 'status',
        message: `Field 'status' must be one of ${[...STATUS_VALUES].join(', ')}; got ${JSON.stringify(data.status)}`,
        severity: 'error',
        code: 'frontmatter/enum',
      });
    }
  }

  if (data.visibility !== undefined) {
    if (typeof data.visibility !== 'string' || !VISIBILITY_VALUES.has(data.visibility)) {
      out.push({
        file: abs,
        line: headlineLine,
        field: 'visibility',
        message: `Field 'visibility' must be one of ${[...VISIBILITY_VALUES].join(', ')}; got ${JSON.stringify(data.visibility)}`,
        severity: 'error',
        code: 'frontmatter/enum',
      });
    }
  }

  for (const listField of ['tags', 'tiers'] as const) {
    const value = data[listField];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) && typeof value !== 'string') {
      out.push({
        file: abs,
        line: headlineLine,
        field: listField,
        message: `Field '${listField}' must be an array or comma-separated string, got ${describeType(value)}`,
        severity: 'error',
        code: 'frontmatter/type',
      });
    }
  }

  for (const dateField of ['date', 'published_at', 'updated_at'] as const) {
    const v = data[dateField];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') {
      // The YAML FAILSAFE schema keeps these as strings, so a non-string
      // means the user wrote `published_at: 2024-01-01` — YAML 1.1's native
      // date — which we no longer accept. Tell them to quote it.
      out.push({
        file: abs,
        line: headlineLine,
        field: dateField,
        message: `Field '${dateField}' must be a quoted ISO-8601 string (e.g. "2024-01-01" or "2024-01-01T10:00:00Z"); got ${describeType(v)}`,
        severity: 'error',
        code: 'frontmatter/type',
      });
      continue;
    }
    if (!isParseableDate(v)) {
      out.push({
        file: abs,
        line: headlineLine,
        field: dateField,
        message: `Field '${dateField}' is not a parseable date: ${JSON.stringify(v)}`,
        severity: 'warning',
        code: 'frontmatter/date',
      });
    }
  }

  return out;
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isParseableDate(s: string): boolean {
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function absolutise(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(cwd, p);
}
