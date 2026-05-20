import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OptionSpec } from './parse.ts';

export const RC_CANDIDATES = ['.nectarrc.json', '.nectarrc'] as const;

export interface RcDiscovery {
  path: string | null;
}

type RcObject = Record<string, unknown>;

export function discoverRcPath(cwd: string = process.cwd()): string | null {
  for (const name of RC_CANDIDATES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function discoverRc(cwd: string = process.cwd()): RcDiscovery {
  return { path: discoverRcPath(cwd) };
}

export function loadRcDefaults(cwd: string = process.cwd()): RcObject | undefined {
  const path = discoverRcPath(cwd);
  if (path === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${path}: ${message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid ${path}: expected a JSON object`);
  }
  return parsed;
}

export function commandRcDefaults(
  commandName: string,
  cwd: string = process.cwd(),
): RcObject | undefined {
  const rc = loadRcDefaults(cwd);
  if (rc === undefined) return undefined;
  const value = rc[commandName];
  return isPlainObject(value) ? value : undefined;
}

export function globalRcDefaults(cwd: string = process.cwd()): RcObject | undefined {
  const rc = loadRcDefaults(cwd);
  if (rc === undefined) return undefined;
  const value = rc.global;
  return isPlainObject(value) ? value : undefined;
}

export function coerceRcValue(
  raw: unknown,
  opt: OptionSpec,
  source: string,
): string | boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (opt.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') return parseRcBoolean(raw, source);
    throw new Error(`Invalid ${source}: expected a boolean`);
  }
  if (typeof raw === 'string') return raw === '' ? undefined : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  throw new Error(`Invalid ${source}: expected a string`);
}

export function readRcBoolean(raw: unknown, source: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return parseRcBoolean(raw, source);
  throw new Error(`Invalid ${source}: expected a boolean`);
}

export function readRcInteger(raw: unknown, source: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${source}: expected a non-negative integer`);
  }
  return n;
}

export function readRcString(raw: unknown, source: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw new Error(`Invalid ${source}: expected a string`);
  return raw === '' ? undefined : raw;
}

export function hasRcKey(defaults: RcObject | undefined, key: string): boolean {
  return defaults !== undefined && Object.hasOwn(defaults, key);
}

export function rcValue(defaults: RcObject | undefined, key: string): unknown {
  return defaults?.[key];
}

function parseRcBoolean(raw: string, source: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off' || v === '') return false;
  throw new Error(`Invalid ${source}: expected a boolean`);
}

function isPlainObject(value: unknown): value is RcObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
