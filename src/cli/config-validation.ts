import { relative } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { isNectarError } from '~/util/errors.ts';
import { reportError } from './report.ts';

export interface ConfigValidationOk {
  ok: true;
  config: NectarConfig;
}

export interface ConfigValidationFailure {
  ok: false;
  error: unknown;
  entry: ConfigValidationEntry;
}

export type ConfigValidationResult = ConfigValidationOk | ConfigValidationFailure;

export interface ConfigValidationEntry {
  code: string;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  hint?: string;
  docsUrl?: string;
  name?: string;
}

export async function validateConfigOnly(opts: {
  cwd: string;
  configPath?: string | undefined;
}): Promise<ConfigValidationResult> {
  try {
    return { ok: true, config: await loadConfig(opts) };
  } catch (error) {
    return { ok: false, error, entry: configErrorEntry(error, opts.cwd) };
  }
}

export function reportConfigValidationError(result: ConfigValidationFailure, cwd: string): void {
  reportError(result.error, cwd);
}

export function configErrorEntry(error: unknown, cwd: string): ConfigValidationEntry {
  if (isNectarError(error)) {
    const entry: ConfigValidationEntry = {
      code: error.code ?? 'config',
      message: error.message,
    };
    if (error.file) entry.file = relativise(cwd, error.file);
    if (error.line !== undefined) entry.line = error.line;
    if (error.col !== undefined) entry.col = error.col;
    if (error.hint) entry.hint = error.hint;
    if (error.docsUrl) entry.docsUrl = error.docsUrl;
    return entry;
  }
  if (error instanceof Error) {
    return { code: 'config', message: error.message, name: error.name };
  }
  return { code: 'config', message: String(error) };
}

function relativise(cwd: string, file: string): string {
  const rel = relative(cwd, file);
  return rel && !rel.startsWith('..') ? rel : file;
}
