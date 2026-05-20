import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import { ZodError, type ZodTypeAny, z } from 'zod';
import { NectarError, suggestClosest } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { type NectarConfig, configSchema } from './schema.ts';

const CONFIG_NAMES = ['nectar.toml', 'nectar.config.toml'];

export interface LoadConfigOptions {
  cwd: string;
  configPath?: string | undefined;
  // When provided, takes precedence over `process.env` for `NECTAR_*`
  // overrides. Tests pass a hand-rolled record so they don't have to mutate
  // the real env and risk leaking state between cases. Production callers
  // omit this and let the loader read from `process.env` directly.
  env?: NodeJS.ProcessEnv | undefined;
}

export async function loadConfig({
  cwd,
  configPath,
  env,
}: LoadConfigOptions): Promise<NectarConfig> {
  const resolved = configPath ? resolveConfigPath(cwd, configPath) : await findConfig(cwd);
  const configDir = resolved ? dirname(resolved) : cwd;
  let parsed: unknown = {};
  if (resolved) {
    const raw = await readFile(resolved, 'utf8');
    try {
      parsed = TOML.parse(raw);
    } catch (err) {
      throw wrapTomlError(err, resolved);
    }
  }

  const withEnv = applyEnvOverrides(parsed, env ?? process.env);
  let config: NectarConfig;
  try {
    config = configSchema.parse(withEnv);
  } catch (err) {
    throw wrapZodError(err, resolved ?? join(cwd, 'nectar.toml'));
  }
  // Anchor relative content/theme paths to the config file's directory
  // rather than the process cwd. Only kicks in when the config lives outside
  // cwd (e.g. `nectar --config /elsewhere/n.toml` from a different shell),
  // so the default cwd==configDir case keeps emitting bare relative paths
  // for back-compat with every consumer that still does `join(cwd, dir)`
  // (#853). When the consumer instead uses `resolve(cwd, dir)`, the absolute
  // path produced here passes through unchanged.
  if (resolve(configDir) !== resolve(cwd)) {
    return resolveProjectPaths(config, configDir);
  }
  return config;
}

/**
 * Return the project root directory: the directory containing `nectar.toml`
 * (or `nectar.config.toml`) if discoverable, falling back to `cwd`. Callers
 * that need to resolve other files relative to the project (e.g. emit paths,
 * plugin imports) can use this to stay consistent with `loadConfig`'s path
 * resolution behaviour.
 */
export async function findProjectRoot({
  cwd,
  configPath,
}: {
  cwd: string;
  configPath?: string | undefined;
}): Promise<string> {
  const resolved = configPath ? resolveConfigPath(cwd, configPath) : await findConfig(cwd);
  return resolved ? dirname(resolved) : cwd;
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

// Path-bearing config keys that should be resolved against the config file's
// directory rather than the caller's cwd. Each entry is a dotted path into
// the parsed config. Anything not listed here stays untouched —
// `build.output_dir` in particular is intentionally NOT here because
// `resolveOutputDir` enforces "inside the project root" by rejecting absolute
// paths; rewriting it to an absolute path under configDir would defeat that
// guard. Instead, callers that run from a different cwd are expected to pass
// `findProjectRoot()` as their `cwd` so the existing relative-path logic
// still anchors at the right place.
const PROJECT_RELATIVE_PATHS: readonly (readonly string[])[] = [
  ['theme', 'dir'],
  ['content', 'posts_dir'],
  ['content', 'pages_dir'],
  ['content', 'authors_dir'],
  ['content', 'tags_dir'],
  ['content', 'assets_dir'],
  ['content', 'static_dir'],
  ['components', 'images', 'cache_dir'],
  ['components', 'og_images', 'template'],
];

function resolveProjectPaths(config: NectarConfig, configDir: string): NectarConfig {
  // Cast through `unknown` so we can write into the strict schema-typed
  // object without restating every nested type. The mutations are confined
  // to the PROJECT_RELATIVE_PATHS table above; everything else is left
  // intact.
  const root = config as unknown as Record<string, unknown>;
  for (const path of PROJECT_RELATIVE_PATHS) {
    const parent = walkParent(root, path);
    if (!parent) continue;
    const key = path[path.length - 1];
    if (!key) continue;
    const current = parent[key];
    if (typeof current !== 'string' || current.length === 0) continue;
    parent[key] = isAbsolute(current) ? current : resolve(configDir, current);
  }
  return config;
}

function walkParent(
  root: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (key === undefined) return undefined;
    const next = current[key];
    if (next === null || typeof next !== 'object') return undefined;
    current = next as Record<string, unknown>;
  }
  return current;
}

// Apply `NECTAR_<SECTION>_<KEY>` env overrides on top of the parsed TOML
// payload. The env var name is mapped back to a dotted config path by
// walking the schema: for each leaf primitive key we precompute its
// `NECTAR_FOO_BAR_BAZ` form, and any matching env var's value is coerced
// into the schema's expected JS type before being merged into the parsed
// object. Unknown `NECTAR_*` vars are ignored silently so the override
// surface stays opt-in (#852).
function applyEnvOverrides(parsed: unknown, env: NodeJS.ProcessEnv): unknown {
  const map = buildEnvVarMap(configSchema);
  let target = applyDeployEnvFallbacks(parsed, env);
  if (map.size === 0) return target;
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('NECTAR_')) continue;
    if (raw === undefined) continue;
    if (ENV_VAR_RESERVED.has(name)) continue;
    const entry = map.get(name);
    if (!entry) continue;
    const value = coerceEnvValue(raw, entry.kind, name);
    if (value === ENV_COERCE_FAILED) continue;
    target = setDeep(target, entry.path, value);
  }
  return target;
}

function applyDeployEnvFallbacks(parsed: unknown, env: NodeJS.ProcessEnv): unknown {
  let target = applyNetlifyDeployUrlFallback(parsed, env);
  target = applyVercelEnvFallback(target, env);
  target = applyCloudflarePagesEnvFallback(target, env);
  return target;
}

function applyNetlifyDeployUrlFallback(parsed: unknown, env: NodeJS.ProcessEnv): unknown {
  if (env.NETLIFY !== 'true' && env.NETLIFY !== '1') return parsed;
  if (env.CONTEXT !== 'deploy-preview' && env.CONTEXT !== 'branch-deploy') return parsed;
  if (env.NECTAR_SITE_URL !== undefined) return parsed;

  const deployUrl = firstNonEmptyEnv(env.DEPLOY_PRIME_URL, env.DEPLOY_URL, env.URL);
  if (deployUrl === undefined) return parsed;
  return setDeep(parsed, ['site', 'url'], deployUrl);
}

function applyVercelEnvFallback(parsed: unknown, env: NodeJS.ProcessEnv): unknown {
  if (env.VERCEL !== 'true' && env.VERCEL !== '1') return parsed;

  let target = parsed;
  if (env.NECTAR_SITE_URL === undefined) {
    const deployUrl = vercelUrlFallback(firstNonEmptyEnv(env.VERCEL_URL));
    if (deployUrl !== undefined) {
      target = setDeep(target, ['site', 'url'], deployUrl);
    }
  }

  target = setDeep(target, ['build', 'metadata', 'provider'], 'vercel');
  const branch = firstNonEmptyEnv(env.VERCEL_GIT_COMMIT_REF);
  if (branch !== undefined) {
    target = setDeep(target, ['build', 'metadata', 'branch'], branch);
  }
  const commitSha = firstNonEmptyEnv(env.VERCEL_GIT_COMMIT_SHA);
  if (commitSha !== undefined) {
    target = setDeep(target, ['build', 'metadata', 'commit_sha'], commitSha);
  }
  return target;
}

function applyCloudflarePagesEnvFallback(parsed: unknown, env: NodeJS.ProcessEnv): unknown {
  if (env.CF_PAGES !== 'true' && env.CF_PAGES !== '1') return parsed;

  let target = parsed;
  if (env.NECTAR_SITE_URL === undefined) {
    const deployUrl = firstNonEmptyEnv(env.CF_PAGES_URL);
    if (deployUrl !== undefined) {
      target = setDeep(target, ['site', 'url'], deployUrl);
    }
  }

  target = setDeep(target, ['build', 'metadata', 'provider'], 'cloudflare_pages');
  const branch = firstNonEmptyEnv(env.CF_PAGES_BRANCH);
  if (branch !== undefined) {
    target = setDeep(target, ['build', 'metadata', 'branch'], branch);
  }
  const commitSha = firstNonEmptyEnv(env.CF_PAGES_COMMIT_SHA);
  if (commitSha !== undefined) {
    target = setDeep(target, ['build', 'metadata', 'commit_sha'], commitSha);
  }
  return target;
}

function vercelUrlFallback(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) return value;
  return `https://${value}`;
}

function firstNonEmptyEnv(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') return value;
  }
  return undefined;
}

// Env vars that look like `NECTAR_*` but address Nectar runtime knobs, not
// `nectar.toml` keys. Listed explicitly so the override walker can ignore
// them without warning. Mirrors the existing usages elsewhere in `src/` and
// in `docs/`.
const ENV_VAR_RESERVED = new Set(['NECTAR_LOG_LEVEL', 'NECTAR_NO_WORKERS', 'NECTAR_DRAFTS']);

type EnvValueKind = 'string' | 'number' | 'boolean';

interface EnvMapEntry {
  path: string[];
  kind: EnvValueKind;
}

function buildEnvVarMap(schema: ZodTypeAny): Map<string, EnvMapEntry> {
  const out = new Map<string, EnvMapEntry>();
  walkSchema(schema, [], out);
  return out;
}

function walkSchema(
  schema: ZodTypeAny,
  path: readonly string[],
  out: Map<string, EnvMapEntry>,
): void {
  const unwrapped = unwrapZodType(schema);
  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape as Record<string, ZodTypeAny>;
    for (const [key, child] of Object.entries(shape)) {
      walkSchema(child, [...path, key], out);
    }
    return;
  }
  if (path.length === 0) return;
  const kind = leafKind(unwrapped);
  if (kind === undefined) return;
  const name = `NECTAR_${path.map((p) => p.toUpperCase()).join('_')}`;
  // First-registered path wins. The schema is acyclic and walked
  // deterministically so duplicates don't happen in practice, but be
  // conservative anyway.
  if (!out.has(name)) out.set(name, { path: [...path], kind });
}

function leafKind(schema: ZodTypeAny): EnvValueKind | undefined {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  // Enums are surfaced as strings — the schema will reject anything outside
  // the allowed set, so we pass the raw env value straight through.
  if (schema instanceof z.ZodEnum) return 'string';
  return undefined;
}

const ENV_COERCE_FAILED = Symbol('env-coerce-failed');

function coerceEnvValue(
  raw: string,
  kind: EnvValueKind,
  varName: string,
): string | number | boolean | typeof ENV_COERCE_FAILED {
  if (kind === 'string') return raw;
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      logger.warn(`Ignoring ${varName}: value ${JSON.stringify(raw)} is not a number.`);
      return ENV_COERCE_FAILED;
    }
    return n;
  }
  if (kind === 'boolean') {
    const lowered = raw.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on') {
      return true;
    }
    if (lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off') {
      return false;
    }
    logger.warn(
      `Ignoring ${varName}: value ${JSON.stringify(raw)} is not a boolean (expected true/false).`,
    );
    return ENV_COERCE_FAILED;
  }
  return ENV_COERCE_FAILED;
}

function setDeep(target: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  // Always clone so the parsed TOML structure isn't mutated in place.
  const root =
    target && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  let cursor = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (key === undefined) break;
    const existing = cursor[key];
    const next =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[key] = next;
    cursor = next;
  }
  const last = path[path.length - 1];
  if (last !== undefined) cursor[last] = value;
  return root;
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
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema as ZodTypeAny;
    } else {
      break;
    }
  }
  return current;
}
