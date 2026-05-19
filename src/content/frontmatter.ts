import matter from 'gray-matter';
import { NectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';

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
  const init: ConstructorParameters<typeof NectarError>[0] = { message, cause: err };
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

export function asDateISO(value: unknown, fallback?: string, context?: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback ?? new Date(0).toISOString();
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    logger.warn(
      `Invalid date in frontmatter${context ? ` (${context})` : ''}: ${JSON.stringify(value)}`,
    );
  } else if (value !== undefined && value !== null) {
    logger.warn(
      `Invalid date type in frontmatter${context ? ` (${context})` : ''}: ${typeof value}`,
    );
  }
  return fallback ?? new Date(0).toISOString();
}
