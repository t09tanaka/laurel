import matter from 'gray-matter';
import yaml from 'js-yaml';
import { LaurelError } from '~/util/errors.ts';

interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

interface ParseFrontmatterOptions {
  filePath?: string;
}

// gray-matter sniffs the fence language tag (`---js`, `---coffee`, `---toml`)
// and dispatches to whichever engine the caller registered. Out of the box it
// also exposes `javascript`, which evaluates the body inside `vm.runInNewContext`
// — a remote-code-execution sink the moment a content file from an untrusted
// source lands in `content/`. We override that by (a) registering exactly one
// engine (`yaml`) and explicitly rejecting any other language tag, and (b)
// using `js-yaml`'s FAILSAFE_SCHEMA so the YAML payload itself can only
// produce strings, arrays, and maps — never custom tags, never `!!js/function`
// constructs, never timestamps Bun/Node would coerce surprising ways.
//
// Date strings stay strings here and are normalised by `asDateISO` downstream;
// callers that care about typed dates already go through that helper, so the
// schema change is invisible to them but blocks the dangerous YAML 1.1 types.
export function parseFrontmatter(
  raw: string,
  options: ParseFrontmatterOptions = {},
): ParsedFrontmatter {
  rejectNonYamlFence(raw, options.filePath);
  try {
    const parsed = matter(raw, MATTER_OPTIONS);
    return { data: (parsed.data ?? {}) as Record<string, unknown>, body: parsed.content };
  } catch (err) {
    throw wrapYamlError(err, options.filePath);
  }
}

// gray-matter's GrayMatterOption type is recursively self-referential
// (`O extends GrayMatterOption<I, O>`), which makes a plain literal awkward
// to annotate. The engine return type is also typed as `object` rather than
// `unknown`, so we coerce inside the engine and cast the whole options bag
// to keep the call site readable.
const MATTER_OPTIONS = {
  excerpt: false,
  language: 'yaml',
  engines: {
    yaml: (input: string): object => {
      const value = yaml.load(input, { schema: yaml.FAILSAFE_SCHEMA });
      // FAILSAFE_SCHEMA always produces strings / arrays / plain maps, never
      // primitives like `true`/`42`, but YAML still allows a scalar at the
      // top level (e.g. `---\nfoo\n---`). Coerce those to an empty object so
      // downstream code sees the documented `data: Record<string, unknown>`
      // shape without crashing on `null`/`string` from a degenerate document.
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as object;
      return {};
    },
  },
} as unknown as Parameters<typeof matter>[1];

// gray-matter recognises `---<lang>` on the opening fence and forwards the
// body to the matching engine. Anything other than the unlabelled `---` /
// `---yaml` form is rejected here so a malicious post can't request a JS or
// CoffeeScript engine; the unlabelled form falls through to our YAML engine
// above.
const FENCE_LANG_RE = /^---([A-Za-z][A-Za-z0-9_-]*)\s*\n/;

function rejectNonYamlFence(raw: string, filePath: string | undefined): void {
  const match = raw.match(FENCE_LANG_RE);
  if (!match) return;
  const lang = (match[1] ?? '').toLowerCase();
  if (lang === 'yaml' || lang === 'yml') return;
  const init: ConstructorParameters<typeof LaurelError>[0] = {
    message: `unsupported frontmatter language: '${match[1]}' (only YAML is allowed)`,
    hint: 'Remove the language tag (use plain `---`) or convert the frontmatter to YAML.',
    code: 'content',
  };
  if (filePath) init.file = filePath;
  throw new LaurelError(init);
}

interface YamlMark {
  line?: number;
  column?: number;
}

function wrapYamlError(err: unknown, filePath: string | undefined): LaurelError {
  const e = err as Error & { mark?: YamlMark; reason?: string };
  const mark = e.mark;
  const message = e.reason
    ? `invalid frontmatter: ${e.reason}`
    : `invalid frontmatter: ${e.message ?? String(err)}`;
  const init: ConstructorParameters<typeof LaurelError>[0] = {
    message,
    cause: err,
    code: 'content',
  };
  if (filePath) init.file = filePath;
  if (mark?.line !== undefined) init.line = mark.line + 1;
  if (mark?.column !== undefined) init.col = mark.column + 1;
  return new LaurelError(init);
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
// throw a `LaurelError` so the build fails with a useful pointer instead of
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
): LaurelError {
  const where = context ? ` (${context})` : '';
  const rendered = renderDateValue(value);
  return new LaurelError({
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
