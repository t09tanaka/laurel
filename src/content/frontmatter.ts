import matter from 'gray-matter';
import { NectarError } from '~/util/errors.ts';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export interface ParseFrontmatterOptions {
  filePath?: string;
}

export function parseFrontmatter(
  raw: string,
  options: ParseFrontmatterOptions = {},
): ParsedFrontmatter {
  try {
    const parsed = matter(raw, MATTER_OPTIONS);
    return { data: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch (err) {
    throw wrapYamlError(err, options.filePath);
  }
}

const MATTER_OPTIONS = { excerpt: false, language: 'yaml' } as const;

interface YamlMark {
  line?: number;
  column?: number;
}

function wrapYamlError(err: unknown, filePath: string | undefined): NectarError {
  const e = err as Error & { mark?: YamlMark; reason?: string };
  const mark = e.mark;
  const message = e.reason
    ? `invalid frontmatter: ${e.reason}`
    : `invalid frontmatter: ${e.message ?? String(err)}`;
  const init: ConstructorParameters<typeof NectarError>[0] = {
    message,
    cause: err,
    code: 'content',
  };
  if (filePath) init.file = filePath;
  if (mark?.line !== undefined) init.line = mark.line + 1;
  if (mark?.column !== undefined) init.col = mark.column + 1;
  return new NectarError(init);
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => asString(v)).filter((v): v is string => Boolean(v));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    return n > 0 ? n : undefined;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

// Parse a frontmatter date value to an ISO string. When `value` is missing or
// an empty string, return `fallback` (or an undefined sentinel via
// `new Date(0)` if no fallback is provided) — this is the "no date provided"
// path and is silent. When `value` is present but cannot be parsed as a date,
// throw a `NectarError` so the build fails with a useful pointer instead of
// silently sorting the post to 1970-01-01 in feeds. The post path is included
// in the error message (the outer `loadMarkdownDir` wraps the error to also
// surface `file` separately, but embedding it in the message keeps it visible
// even when callers re-wrap or log without a formatter).
export function asDateISO(value: unknown, fallback?: string, context?: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw invalidDateError(context, value, 'value is an Invalid Date');
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback ?? new Date(0).toISOString();
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    throw invalidDateError(context, value, 'unparseable date string');
  }
  if (value === undefined || value === null) {
    return fallback ?? new Date(0).toISOString();
  }
  throw invalidDateError(context, value, `unexpected ${typeof value} value`);
}

function invalidDateError(
  context: string | undefined,
  value: unknown,
  reason: string,
): NectarError {
  const where = context ? ` (${context})` : '';
  const rendered = renderDateValue(value);
  return new NectarError({
    message: `Invalid date in frontmatter${where}: ${reason} — got ${rendered}`,
    hint: 'Use an ISO-8601 date such as 2026-01-02 or 2026-01-02T03:04:05Z, or remove the field to fall back to the file mtime.',
    code: 'content',
  });
}

function renderDateValue(value: unknown): string {
  if (value instanceof Date) return `Date(${value.toString()})`;
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
