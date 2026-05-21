export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(raw: string | undefined): Level | undefined {
  if (raw === undefined) return undefined;
  return raw in order ? (raw as Level) : undefined;
}

const envLevel = parseLevel(process.env.NECTAR_LOG_LEVEL);
let threshold = envLevel ? order[envLevel] : order.info;

let warningCount = 0;
let warningsAsErrors = false;
let warningsAsErrorsFailure = false;

// Output mode controls how `logger.<level>(...)` is serialised. `text` (the
// default) keeps human-readable info/debug/trace output on stdout and
// warning/error output on stderr.
// `json` switches to one JSON object per line ({ts,level,msg,...fields}) so CI
// pipelines and log aggregators can consume nectar output without parsing
// the surface text. Toggled by `--log-format=json` (global), legacy `--json`,
// env `NECTAR_LOG_FORMAT=json`, or legacy env `NECTAR_JSON=1`.
export type LogOutputMode = 'text' | 'json';
let outputMode: LogOutputMode = parseInitialJsonMode(process.env);

// Whether ANSI color codes are emitted in human text mode. Detection rules
// follow widely-adopted conventions:
//   - `--no-color` CLI flag (or `NECTAR_NO_COLOR=1`)        → off
//   - `NO_COLOR` env var set (any non-empty value)          → off
//   - `FORCE_COLOR` set to truthy or a level (1/2/3/true)   → on
//   - otherwise: enabled when stderr is a TTY
// `FORCE_COLOR=0` is treated as an explicit off, matching the npm/node
// conventions debug/chalk/picocolors all follow.
let colorEnabled: boolean = detectColorEnabled(process.env);

function parseInitialJsonMode(env: NodeJS.ProcessEnv): LogOutputMode {
  const format = env.NECTAR_LOG_FORMAT;
  if (format === 'json') return 'json';
  if (format === 'pretty') return 'text';
  const raw = env.NECTAR_JSON;
  if (raw === undefined || raw === '') return 'text';
  if (/^(1|true|yes|on)$/i.test(raw.trim())) return 'json';
  return 'text';
}

function parseEnvFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function detectColorEnabled(env: NodeJS.ProcessEnv): boolean {
  // NECTAR_NO_COLOR is the project-namespaced override. Parse it as boolean
  // so `NECTAR_NO_COLOR=0` (explicit re-enable) wins over a globally-set
  // `NO_COLOR=1`. Anything truthy → off; explicit `0`/`false`/empty → leave
  // color on (and skip the NO_COLOR check).
  const nectarNoColor = env.NECTAR_NO_COLOR;
  if (nectarNoColor !== undefined && nectarNoColor !== '') {
    if (/^(1|true|yes|on)$/i.test(nectarNoColor.trim())) return false;
    if (/^(0|false|no|off)$/i.test(nectarNoColor.trim())) {
      // Explicit re-enable: jump past the NO_COLOR check and fall through to
      // FORCE_COLOR / TTY detection.
    } else {
      // Unrecognised value: ignore and continue.
    }
  } else if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    const v = force.trim().toLowerCase();
    if (v === '0' || v === 'false') return false;
    if (v === '' || v === '1' || v === '2' || v === '3' || v === 'true') return true;
  }
  // `Bun.write(process.stderr, ...)` does not expose isTTY directly; fall back
  // to the underlying stream. process.stderr.isTTY is `true | undefined` per
  // node typings; default to false when the descriptor is not a terminal.
  return process.stderr.isTTY === true;
}

export function setOutputMode(mode: LogOutputMode): void {
  outputMode = mode;
}

export function getOutputMode(): LogOutputMode {
  return outputMode;
}

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function getColorEnabled(): boolean {
  return colorEnabled;
}

// Allow callers (e.g. CLI entrypoint after flag parsing) to recompute from
// the current env without restarting the process. Mostly used in tests.
export function refreshColorFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  colorEnabled = detectColorEnabled(env);
}

// ANSI color helpers. Callers should always go through `colorize` so a single
// `setColorEnabled(false)` switch disables every call site, including the
// human-text level tags in this module.
const ANSI: Record<string, string> = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};

export function colorize(text: string, color: keyof typeof ANSI): string {
  if (!colorEnabled) return text;
  const open = ANSI[color];
  if (!open) return text;
  return `${open}${text}${ANSI.reset}`;
}

// Fields object can be threaded through any logger call as the last argument
// when it's a plain object. The text formatter renders it as `key=value`
// trailing pairs; the JSON formatter emits them as top-level properties next
// to the stable {ts, level, msg} envelope. Splitting strings vs structured
// data this way means existing call sites (`logger.info('built', count,
// 'routes')`) keep working unchanged.
export type LogFields = Record<string, unknown>;

function isFieldsObject(value: unknown): value is LogFields {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Error) &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function splitFields(parts: unknown[]): { fields?: LogFields; rest: unknown[] } {
  if (parts.length === 0) return { rest: parts };
  const last = parts[parts.length - 1];
  if (isFieldsObject(last)) {
    return { fields: last, rest: parts.slice(0, -1) };
  }
  return { rest: parts };
}

function emit(level: Level, parts: unknown[]): void {
  if (level === 'warn') warningCount += 1;
  const effectiveLevel: Level = level === 'warn' && warningsAsErrors ? 'error' : level;
  if (level === 'warn' && warningsAsErrors) warningsAsErrorsFailure = true;
  if (order[effectiveLevel] < threshold) return;
  const { fields, rest } = splitFields(parts);
  const message = rest.map(formatPart).join(' ');
  if (outputMode === 'json') {
    const record: Record<string, unknown> = {
      ...(fields ? sanitizeFields(fields) : undefined),
      ts: new Date().toISOString(),
      level: effectiveLevel,
      msg: message,
    };
    writeToLevelStream(effectiveLevel, `${safeJsonStringify(record)}\n`);
    return;
  }
  const trailing = fields ? ` ${formatFieldsForText(fields)}` : '';
  writeToLevelStream(effectiveLevel, formatTextLine(effectiveLevel, message, trailing));
}

function writeToLevelStream(level: Level, chunk: string): void {
  const stream = levelStream(level);
  stream.write(chunk);
}

function levelStream(level: Level): NodeJS.WriteStream {
  return order[level] >= order.warn ? process.stderr : process.stdout;
}

function formatTextLine(level: Level, message: string, trailing: string): string {
  if (shouldPrefixTextTimestamp(level)) {
    return `[${new Date().toISOString()}] ${level} ${message}${trailing}\n`;
  }
  const tag = level === 'info' ? '' : `${colorize(`[${level}]`, levelColor(level))} `;
  return `${tag}${message}${trailing}\n`;
}

function shouldPrefixTextTimestamp(level: Level): boolean {
  if (parseEnvFlag(process.env.NECTAR_LOG_TIMESTAMPS)) return true;
  return levelStream(level).isTTY !== true;
}

function levelColor(level: Level): keyof typeof ANSI {
  switch (level) {
    case 'error':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'debug':
    case 'trace':
      return 'gray';
    default:
      return 'cyan';
  }
}

function formatFieldsForText(fields: LogFields): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    pairs.push(`${k}=${formatFieldValue(v)}`);
  }
  return pairs.join(' ');
}

function formatFieldValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message };
      continue;
    }
    out[k] = v;
  }
  return out;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      msg: '[unserialisable]',
    });
  }
}

function formatPart(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return part.stack ?? part.message;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

export const logger = {
  trace: (...parts: unknown[]) => emit('trace', parts),
  debug: (...parts: unknown[]) => emit('debug', parts),
  info: (...parts: unknown[]) => emit('info', parts),
  warn: (...parts: unknown[]) => emit('warn', parts),
  error: (...parts: unknown[]) => emit('error', parts),
};

export function setLogLevel(level: Level): void {
  threshold = order[level];
}

export function getLogLevel(): Level {
  for (const [name, value] of Object.entries(order)) {
    if (value === threshold) return name as Level;
  }
  return 'info';
}

export function getWarningCount(): number {
  return warningCount;
}

export function resetWarningCount(): void {
  warningCount = 0;
}

export function setWarningsAsErrors(enabled: boolean): void {
  warningsAsErrors = enabled;
}

export function getWarningsAsErrors(): boolean {
  return warningsAsErrors;
}

export function hasWarningsAsErrorsFailure(): boolean {
  return warningsAsErrorsFailure;
}

export function resetWarningsAsErrorsFailure(): void {
  warningsAsErrorsFailure = false;
}
