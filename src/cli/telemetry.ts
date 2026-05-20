import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, homedir, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { getNectarVersion } from '~/util/nectar-version.ts';
import type { VersionJson } from './version.ts';

export const DEFAULT_TELEMETRY_ENDPOINT = 'https://telemetry.nectar.dev/v1/usage';
export const TELEMETRY_SCHEMA_VERSION = 1;

type TelemetryConfigSource = NodeJS.ProcessEnv | string;

export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  anonymousMachineId?: string;
  crashReports?: 'never';
}

export interface TelemetryPayload {
  schema_version: 1;
  event: 'cli_command';
  anonymous_machine_id: string;
  command: string;
  duration_ms: number;
  success: boolean;
  exit_code: number;
  nectar_version: string;
  bun_version: string | null;
  os: {
    platform: string;
    arch: string;
    release: string;
  };
}

export interface TelemetrySendOptions {
  command: string;
  durationMs: number;
  exitCode: number;
  env?: NodeJS.ProcessEnv;
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
}

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

export function telemetryConfigPath(source: TelemetryConfigSource = process.env): string {
  if (typeof source === 'string') return source;
  const explicit = source.NECTAR_TELEMETRY_CONFIG;
  if (explicit !== undefined && explicit !== '') return explicit;
  const xdg = source.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== '') return join(xdg, 'nectar', 'telemetry.json');
  return join(homedir(), '.config', 'nectar', 'telemetry.json');
}

export async function readTelemetryConfig(
  source: TelemetryConfigSource = process.env,
): Promise<TelemetryConfig> {
  const path = telemetryConfigPath(source);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<TelemetryConfig>;
    return sanitizeTelemetryConfig(parsed);
  } catch (err) {
    if (isNotFoundError(err)) return { enabled: false };
    throw new Error(`Invalid telemetry config at ${path}: ${errMessage(err)}`);
  }
}

export async function writeTelemetryConfig(
  config: TelemetryConfig,
  source: TelemetryConfigSource = process.env,
): Promise<void> {
  const path = telemetryConfigPath(source);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(sanitizeTelemetryConfig(config), null, 2)}\n`, {
    mode: 0o600,
  });
}

export function resolveTelemetryEndpoint(
  config: TelemetryConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const envEndpoint = env.NECTAR_TELEMETRY_ENDPOINT;
  if (envEndpoint !== undefined && envEndpoint !== '') return envEndpoint;
  return config.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
}

export async function buildTelemetryPayload(options: {
  command: string;
  durationMs: number;
  exitCode: number;
  anonymousMachineId: string;
}): Promise<TelemetryPayload> {
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    event: 'cli_command',
    anonymous_machine_id: options.anonymousMachineId,
    command: options.command,
    duration_ms: Math.max(0, Math.round(options.durationMs)),
    success: options.exitCode === 0,
    exit_code: options.exitCode,
    nectar_version: await getNectarVersion(),
    bun_version: typeof Bun === 'undefined' ? null : Bun.version,
    os: {
      platform: platform(),
      arch: arch(),
      release: release(),
    },
  };
}

export async function sendCommandTelemetry(options: TelemetrySendOptions): Promise<boolean> {
  const env = options.env ?? process.env;
  const config = await readTelemetryConfig(env);
  if (!config.enabled || config.anonymousMachineId === undefined) return false;

  const endpoint = resolveTelemetryEndpoint(config, env);
  const payload = await buildTelemetryPayload({
    command: options.command,
    durationMs: options.durationMs,
    exitCode: options.exitCode,
    anonymousMachineId: config.anonymousMachineId,
  });
  const fetchFn = options.fetchFn ?? fetch;
  const abort = new AbortController();
  const timeout = setTimeout(
    () => abort.abort(),
    parseTelemetryTimeoutMs(env.NECTAR_TELEMETRY_TIMEOUT_MS),
  );
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': `nectar/${payload.nectar_version}`,
      },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    return res.ok;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enableTelemetry(
  endpoint: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelemetryConfig> {
  const existing = await readTelemetryConfig(env);
  const next: TelemetryConfig = {
    ...existing,
    enabled: true,
    anonymousMachineId: existing.anonymousMachineId ?? crypto.randomUUID(),
    endpoint: endpoint ?? existing.endpoint,
  };
  await writeTelemetryConfig(next, env);
  return next;
}

export async function disableTelemetry(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelemetryConfig> {
  const existing = await readTelemetryConfig(env);
  const next: TelemetryConfig = {
    ...existing,
    enabled: false,
  };
  await writeTelemetryConfig(next, env);
  return next;
}

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
  const configSource = opts.configPath ?? process.env;
  const config = await readTelemetryConfig(configSource);
  if (config.crashReports === 'never') return 'skipped-never';

  const answer = normalizePromptAnswer(
    await (opts.prompt ?? promptOnStderr)('Send anonymous crash report? (y/N/never) '),
  );
  if (answer === 'never') {
    await writeTelemetryConfig({ ...config, crashReports: 'never' }, configSource);
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

export function versionsForCrashReport(version: VersionJson): CrashReportPayload['versions'] {
  return {
    nectar: version.version,
    bun: version.bun,
    node: version.node,
    commit: version.commit,
  };
}

function parseTelemetryTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 500;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 5000) : 500;
}

function sanitizeTelemetryConfig(raw: Partial<TelemetryConfig>): TelemetryConfig {
  const config: TelemetryConfig = { enabled: raw.enabled === true };
  if (typeof raw.endpoint === 'string' && raw.endpoint !== '') config.endpoint = raw.endpoint;
  if (typeof raw.anonymousMachineId === 'string' && raw.anonymousMachineId !== '') {
    config.anonymousMachineId = raw.anonymousMachineId;
  }
  if (raw.crashReports === 'never') config.crashReports = 'never';
  return config;
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

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
