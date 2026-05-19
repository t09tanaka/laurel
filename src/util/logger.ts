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

function emit(level: Level, parts: unknown[]): void {
  if (level === 'warn') warningCount += 1;
  if (order[level] < threshold) return;
  const tag = level === 'info' ? '' : `[${level}] `;
  process.stderr.write(`${tag}${parts.map(formatPart).join(' ')}\n`);
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
