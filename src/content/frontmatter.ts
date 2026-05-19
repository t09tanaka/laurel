import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const parsed = matter(raw);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content };
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

export function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function asDateISO(value: unknown, fallback?: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback ?? new Date(0).toISOString();
}
