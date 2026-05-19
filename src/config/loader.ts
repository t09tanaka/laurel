import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import TOML from '@iarna/toml';
import { ZodError } from 'zod';
import { NectarError } from '~/util/errors.ts';
import { type NectarConfig, configSchema } from './schema.ts';

const CONFIG_NAMES = ['nectar.toml', 'nectar.config.toml'];

export interface LoadConfigOptions {
  cwd: string;
  configPath?: string | undefined;
}

export async function loadConfig({ cwd, configPath }: LoadConfigOptions): Promise<NectarConfig> {
  const resolved = configPath ? resolveConfigPath(cwd, configPath) : await findConfig(cwd);
  if (!resolved) {
    return configSchema.parse({});
  }
  const raw = await readFile(resolved, 'utf8');
  let parsed: unknown;
  try {
    parsed = TOML.parse(raw);
  } catch (err) {
    throw wrapTomlError(err, resolved);
  }
  try {
    return configSchema.parse(parsed);
  } catch (err) {
    throw wrapZodError(err, resolved);
  }
}

function resolveConfigPath(cwd: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : join(cwd, configPath);
}

async function findConfig(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_NAMES) {
    const candidate = join(cwd, name);
    const file = Bun.file(candidate);
    if (await file.exists()) return candidate;
  }
  return undefined;
}

interface TomlParseError extends Error {
  line?: number;
  col?: number;
}

function wrapTomlError(err: unknown, file: string): NectarError {
  const e = err as TomlParseError;
  const rawMsg = e.message ?? String(err);
  const message = `invalid TOML: ${stripTomlContext(rawMsg)}`;
  const init: ConstructorParameters<typeof NectarError>[0] = { message, file, cause: err };
  if (typeof e.line === 'number') init.line = e.line + 1;
  if (typeof e.col === 'number') init.col = e.col + 1;
  return new NectarError(init);
}

function stripTomlContext(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? message;
  return firstLine.replace(/\s+at row \d+, col \d+, pos \d+:?/, '').trim();
}

function wrapZodError(err: unknown, file: string): NectarError {
  if (!(err instanceof ZodError)) {
    return new NectarError({
      message: err instanceof Error ? err.message : String(err),
      file,
      cause: err,
    });
  }
  const issue = err.issues[0];
  if (!issue) {
    return new NectarError({ message: 'invalid config', file, cause: err });
  }
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const message = `invalid config at \`${path}\`: ${issue.message.toLowerCase()}`;
  const hint =
    err.issues.length > 1
      ? `${err.issues.length - 1} more issue${err.issues.length - 1 === 1 ? '' : 's'} — fix this one and re-run`
      : undefined;
  const init: ConstructorParameters<typeof NectarError>[0] = { message, file, cause: err };
  if (hint) init.hint = hint;
  return new NectarError(init);
}
