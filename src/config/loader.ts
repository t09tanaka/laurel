import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import TOML from '@iarna/toml';
import { ZodError, type ZodTypeAny, z } from 'zod';
import { NectarError, suggestClosest } from '~/util/errors.ts';
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
  const init: ConstructorParameters<typeof NectarError>[0] = {
    message,
    file,
    cause: err,
    code: 'config',
  };
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
      code: 'config',
    });
  }
  const issue = err.issues[0];
  if (!issue) {
    return new NectarError({ message: 'invalid config', file, cause: err, code: 'config' });
  }
  if (issue.code === 'unrecognized_keys') {
    return buildUnrecognizedKeysError(err, issue, file);
  }
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const message = `invalid config at \`${path}\`: ${issue.message.toLowerCase()}`;
  const hint = remainingIssuesHint(err);
  const init: ConstructorParameters<typeof NectarError>[0] = {
    message,
    file,
    cause: err,
    code: 'config',
  };
  if (hint) init.hint = hint;
  return new NectarError(init);
}

function buildUnrecognizedKeysError(
  err: ZodError,
  issue: z.ZodIssue & { code: 'unrecognized_keys' },
  file: string,
): NectarError {
  const unknownKey = issue.keys[0] ?? '';
  const fullPath = [...issue.path.map(String), unknownKey].filter((s) => s.length > 0);
  const pathLabel = fullPath.length > 0 ? fullPath.join('.') : '(root)';
  const message = `invalid config: unknown key \`${pathLabel}\``;
  const knownKeys = knownKeysAtPath(configSchema, issue.path);
  let hint: string | undefined;
  if (knownKeys && unknownKey) {
    const suggestion = suggestClosest(unknownKey, knownKeys);
    if (suggestion) {
      const suggested = [...issue.path.map(String), suggestion].join('.');
      hint = `did you mean \`${suggested}\`?`;
    }
  }
  if (!hint) hint = remainingIssuesHint(err);
  const init: ConstructorParameters<typeof NectarError>[0] = {
    message,
    file,
    cause: err,
    code: 'config',
  };
  if (hint) init.hint = hint;
  return new NectarError(init);
}

function remainingIssuesHint(err: ZodError): string | undefined {
  const remaining = err.issues.length - 1;
  if (remaining <= 0) return undefined;
  return `${remaining} more issue${remaining === 1 ? '' : 's'} — fix this one and re-run`;
}

function knownKeysAtPath(
  root: ZodTypeAny,
  path: readonly (string | number)[],
): string[] | undefined {
  let current: ZodTypeAny = root;
  for (const segment of path) {
    current = unwrapZodType(current);
    if (current instanceof z.ZodObject) {
      const shape = current.shape as Record<string, ZodTypeAny>;
      const next = typeof segment === 'string' ? shape[segment] : undefined;
      if (!next) return undefined;
      current = next;
    } else if (current instanceof z.ZodArray) {
      current = current.element as ZodTypeAny;
    } else {
      return undefined;
    }
  }
  current = unwrapZodType(current);
  if (current instanceof z.ZodObject) {
    return Object.keys(current.shape);
  }
  return undefined;
}

function unwrapZodType(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  while (true) {
    if (current instanceof z.ZodDefault) {
      current = current._def.innerType as ZodTypeAny;
    } else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as ZodTypeAny;
    } else {
      break;
    }
  }
  return current;
}
