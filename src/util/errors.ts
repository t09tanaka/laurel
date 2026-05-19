import { relative } from 'node:path';

export interface NectarErrorLocation {
  file?: string;
  line?: number;
  col?: number;
}

export interface NectarErrorInit extends NectarErrorLocation {
  message: string;
  hint?: string;
  cause?: unknown;
}

export class NectarError extends Error {
  readonly file?: string;
  readonly line?: number;
  readonly col?: number;
  readonly hint?: string;

  constructor(init: NectarErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'NectarError';
    this.file = init.file;
    this.line = init.line;
    this.col = init.col;
    this.hint = init.hint;
  }
}

export function isNectarError(value: unknown): value is NectarError {
  return value instanceof NectarError;
}

export interface FormatOptions {
  cwd?: string;
}

export function formatNectarError(err: NectarError, options: FormatOptions = {}): string {
  const headline = formatPointer(err, options);
  const lines: string[] = [];
  if (headline) lines.push(headline);
  else lines.push(`---- ${err.message}`);
  if (err.hint) lines.push(`     hint: ${err.hint}`);
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
    return new NectarError({
      message: err.message,
      file: err.file ?? fallback.file,
      line: err.line ?? fallback.line,
      col: err.col ?? fallback.col,
      hint: err.hint,
      cause: err.cause ?? err,
    });
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
