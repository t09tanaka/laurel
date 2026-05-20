import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { VersionJson } from './version.ts';

export interface CrashReportPayload {
  kind: 'crash';
  error: {
    class: string;
    message: string;
  };
  stack: string | null;
  argv: string[];
  versions: {
    nectar: string;
    bun: string | null;
    node: string;
    commit: string | null;
  };
}

export interface TelemetryConfig {
  crashReports?: 'never';
}

export type CrashPromptResult =
  | 'sent'
  | 'declined'
  | 'stored-never'
  | 'skipped-never'
  | 'skipped-non-tty'
  | 'send-unavailable'
  | 'send-failed';

interface CrashPromptOptions {
  argv: string[];
  versions: CrashReportPayload['versions'];
  configPath?: string;
  isTty?: boolean;
  prompt?: (question: string) => Promise<string>;
  send?: (payload: CrashReportPayload) => Promise<boolean | undefined>;
}

const VALUE_FLAGS = new Set([
  '--author',
  '--base-path',
  '--base-url',
  '--config',
  '--date',
  '--editor',
  '--host',
  '--output',
  '--port',
  '--slug',
  '--tags',
  '--to',
  '--url',
  '-a',
  '-c',
  '-e',
  '-o',
  '-p',
]);

export function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (i === 1) {
      redacted.push('[entry]');
      continue;
    }
    if (redactNext) {
      redacted.push('[redacted]');
      redactNext = false;
      continue;
    }
    if (arg === '--') {
      redacted.push('--');
      for (let j = i + 1; j < argv.length; j += 1) {
        redacted.push('[arg]');
      }
      break;
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      const [name] = arg.split('=', 1);
      redacted.push(`${name}=[redacted]`);
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }
    const shortValueFlag = arg.slice(0, 2);
    if (VALUE_FLAGS.has(shortValueFlag) && arg.length > 2) {
      const separator = arg[2] === '=' ? '=' : '';
      redacted.push(`${shortValueFlag}${separator}[redacted]`);
      continue;
    }
    if (arg.startsWith('-')) {
      redacted.push(arg);
      continue;
    }
    redacted.push(i <= 2 ? arg : '[arg]');
  }
  return redacted;
}

export function sanitizeStack(stack: string | undefined): string | null {
  if (stack === undefined || stack.trim() === '') return null;
  return stack
    .split('\n')
    .slice(0, 40)
    .map((line) =>
      line.replace(
        /(?:(?:file:\/\/)?\/|[A-Za-z]:\\)[^():\n]+(?:[/\\][^():\n]+)*(\:\d+\:\d+)/g,
        '[path]$1',
      ),
    )
    .join('\n');
}

export function buildCrashReportPayload(
  err: unknown,
  opts: { argv: string[]; versions: CrashReportPayload['versions'] },
): CrashReportPayload {
  const error = normalizeError(err);
  return {
    kind: 'crash',
    error: {
      class: error.name,
      message: error.message,
    },
    stack: sanitizeStack(error.stack),
    argv: redactArgv(opts.argv),
    versions: opts.versions,
  };
}

export async function handleCrashReportPrompt(
  err: unknown,
  opts: CrashPromptOptions,
): Promise<CrashPromptResult> {
  if (opts.isTty === false) return 'skipped-non-tty';
  const configPath = opts.configPath ?? defaultTelemetryConfigPath();
  const config = await readTelemetryConfig(configPath);
  if (config.crashReports === 'never') return 'skipped-never';

  const answer = normalizePromptAnswer(
    await (opts.prompt ?? promptOnStderr)('Send anonymous crash report? (y/N/never) '),
  );
  if (answer === 'never') {
    await writeTelemetryConfig(configPath, { crashReports: 'never' });
    return 'stored-never';
  }
  if (answer !== 'yes') return 'declined';

  const payload = buildCrashReportPayload(err, { argv: opts.argv, versions: opts.versions });
  try {
    const sent = await (opts.send ?? sendCrashReport)(payload);
    return sent === false ? 'send-unavailable' : 'sent';
  } catch {
    return 'send-failed';
  }
}

export async function readTelemetryConfig(
  path = defaultTelemetryConfigPath(),
): Promise<TelemetryConfig> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as TelemetryConfig;
    return parsed.crashReports === 'never' ? { crashReports: 'never' } : {};
  } catch {
    return {};
  }
}

async function writeTelemetryConfig(path: string, config: TelemetryConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function defaultTelemetryConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'nectar', 'telemetry.json');
}

function normalizeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name || err.constructor.name || 'Error',
      message: err.message,
      stack: err.stack,
    };
  }
  return { name: typeof err, message: String(err) };
}

function normalizePromptAnswer(answer: string): 'yes' | 'no' | 'never' {
  const normalized = answer.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes') return 'yes';
  if (normalized === 'never') return 'never';
  return 'no';
}

async function promptOnStderr(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function sendCrashReport(payload: CrashReportPayload): Promise<boolean> {
  const endpoint = process.env.NECTAR_CRASH_REPORT_URL?.trim();
  if (!endpoint) return false;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export function versionsForCrashReport(version: VersionJson): CrashReportPayload['versions'] {
  return {
    nectar: version.version,
    bun: version.bun,
    node: version.node,
    commit: version.commit,
  };
}
