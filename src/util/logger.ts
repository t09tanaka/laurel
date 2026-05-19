type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.NECTAR_LOG_LEVEL ?? 'info') as Level;
const threshold = order[envLevel] ?? order.info;

let warningCount = 0;

function emit(level: Level, parts: unknown[]): void {
  if (level === 'warn') warningCount += 1;
  if (order[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const tag = level === 'info' ? '' : `[${level}] `;
  stream.write(`${tag}${parts.map(formatPart).join(' ')}\n`);
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
  debug: (...parts: unknown[]) => emit('debug', parts),
  info: (...parts: unknown[]) => emit('info', parts),
  warn: (...parts: unknown[]) => emit('warn', parts),
  error: (...parts: unknown[]) => emit('error', parts),
};

export function getWarningCount(): number {
  return warningCount;
}

export function resetWarningCount(): void {
  warningCount = 0;
}
