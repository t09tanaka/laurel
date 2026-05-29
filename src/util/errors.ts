import { relative } from 'node:path';

// Categories used to drive the `nectar build` process exit code. Each value
// maps to a reserved code in `EXIT_CODES` so callers (CI, shell scripts) can
// distinguish a config typo from a missing template without parsing stderr.
// Add a value here when introducing a new boundary; do not reuse codes.
type NectarErrorCode = 'config' | 'content' | 'theme' | 'render' | 'emit';

// Reserved process exit codes for the CLI. Keep in sync with docs and any
// shell wrappers that grep on exit status. 0/1/2/130 are POSIX/Node defaults;
// 3-7 are nectar-specific and tied to `NectarErrorCode`.
export const EXIT_CODES = {
  ok: 0,
  generic: 1,
  usage: 2,
  config: 3,
  content: 4,
  theme: 5,
  render: 6,
  emit: 7,
  sigint: 130,
} as const;

interface NectarErrorLocation {
  file?: string;
  line?: number;
  col?: number;
}

interface NectarErrorInit extends NectarErrorLocation {
  message: string;
  hint?: string;
  docsUrl?: string;
  cause?: unknown;
  code?: NectarErrorCode;
}

export class NectarError extends Error {
  readonly file?: string;
  readonly line?: number;
  readonly col?: number;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly code?: NectarErrorCode;

  constructor(init: NectarErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'NectarError';
    this.file = init.file;
    this.line = init.line;
    this.col = init.col;
    this.hint = init.hint;
    this.docsUrl = init.docsUrl;
    this.code = init.code;
  }
}

export function isNectarError(value: unknown): value is NectarError {
  return value instanceof NectarError;
}

export function exitCodeForError(err: unknown): number {
  if (!isNectarError(err) || err.code === undefined) return EXIT_CODES.generic;
  return EXIT_CODES[err.code];
}

interface FormatOptions {
  cwd?: string;
}

export function formatNectarError(err: NectarError, options: FormatOptions = {}): string {
  const headline = formatPointer(err, options);
  const lines: string[] = [];
  if (headline) lines.push(headline);
  else lines.push(`---- ${err.message}`);
  if (err.hint) lines.push(`     hint: ${err.hint}`);
  if (err.docsUrl) lines.push(`     docs: ${err.docsUrl}`);
  return lines.join('\n');
}

function formatPointer(err: NectarError, options: FormatOptions): string | undefined {
  if (!err.file) return undefined;
  const file = options.cwd ? toRelative(options.cwd, err.file) : err.file;
  const loc =
    err.line !== undefined ? `:${err.line}${err.col !== undefined ? `:${err.col}` : ''}` : '';
  return `---- ${file}${loc} - ${err.message}`;
}

function toRelative(cwd: string, file: string): string {
  const rel = relative(cwd, file);
  if (!rel || rel.startsWith('..')) return file;
  return rel;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

export function suggestClosest(input: string, candidates: readonly string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  let best: string | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  const threshold = Math.max(1, Math.floor(input.length / 3));
  for (const candidate of candidates) {
    const dist = levenshtein(input, candidate);
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

export function toNectarError(err: unknown, fallback: NectarErrorLocation = {}): NectarError {
  if (err instanceof NectarError) {
    if ((err.file ?? fallback.file) === err.file) return err;
    const init: NectarErrorInit = {
      message: err.message,
      file: err.file ?? fallback.file,
      line: err.line ?? fallback.line,
      col: err.col ?? fallback.col,
      hint: err.hint,
      docsUrl: err.docsUrl,
      cause: err.cause ?? err,
    };
    if (err.code !== undefined) init.code = err.code;
    return new NectarError(init);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new NectarError({
    message,
    file: fallback.file,
    line: fallback.line,
    col: fallback.col,
    cause: err,
  });
}
