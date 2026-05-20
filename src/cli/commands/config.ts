import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import { loadConfig } from '~/config/loader.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { CONFIG_SPEC } from '../specs.ts';

const CONFIG_CANDIDATES = ['nectar.toml', 'nectar.config.toml'];
const CONFIG_PRINT_FORMATS = new Set(['json', 'toml']);
type ConfigPrintFormat = 'json' | 'toml';

export async function runConfig(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CONFIG_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CONFIG_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CONFIG_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  const asJson = parsed.values.json === true;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const cwd = process.cwd();

  if (sub === 'print') {
    if (parsed.positionals.length > 1) {
      process.stderr.write('`config print` takes no further arguments.\n');
      return 2;
    }
    const formatResult = resolvePrintFormat(parsed.values.format, asJson);
    if (formatResult.ok === false) {
      process.stderr.write(`${formatResult.message}\n`);
      return 2;
    }
    try {
      const config = await loadConfig({ cwd, configPath });
      process.stdout.write(renderResolvedConfig(config, formatResult.format));
      return 0;
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  }

  if (sub === 'path') {
    if (parsed.positionals.length > 1) {
      process.stderr.write('`config path` takes no further arguments.\n');
      return 2;
    }
    const resolved = resolveConfigPath(cwd, configPath);
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ config_path: resolved }, null, 2)}\n`);
    } else if (resolved) {
      process.stdout.write(`${resolved}\n`);
    }
    return 0;
  }

  if (sub === 'get') {
    const key = parsed.positionals[1];
    if (!key) {
      process.stderr.write('`config get` requires a dotted key argument (e.g. `site.url`).\n');
      return 2;
    }
    if (parsed.positionals.length > 2) {
      process.stderr.write('`config get` takes exactly one dotted key argument.\n');
      return 2;
    }
    try {
      const config = await loadConfig({ cwd, configPath });
      const value = lookupDotted(config as unknown as Record<string, unknown>, key);
      if (value === undefined) {
        process.stderr.write(`Unknown config key: ${key}\n`);
        return 1;
      }
      if (asJson) {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatScalar(value)}\n`);
      }
      return 0;
    } catch (err) {
      reportError(err, cwd);
      return 1;
    }
  }

  process.stderr.write(
    `Unknown subcommand: ${sub ?? '<missing>'}. Expected \`print\`, \`get <key>\`, or \`path\`.\n`,
  );
  return 2;
}

function resolvePrintFormat(
  raw: string | boolean | undefined,
  asJson: boolean,
): { ok: true; format: ConfigPrintFormat } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, format: asJson ? 'json' : 'toml' };
  if (typeof raw !== 'string' || !CONFIG_PRINT_FORMATS.has(raw)) {
    return { ok: false, message: 'Invalid config print format. Expected `json` or `toml`.' };
  }
  if (asJson && raw !== 'json') {
    return { ok: false, message: '`--json` cannot be combined with `--format toml`.' };
  }
  return { ok: true, format: raw as ConfigPrintFormat };
}

function renderResolvedConfig(config: unknown, format: ConfigPrintFormat): string {
  if (format === 'json') return `${JSON.stringify(config, null, 2)}\n`;
  return TOML.stringify(config as Record<string, unknown>);
}

function resolveConfigPath(cwd: string, configPath: string | undefined): string | null {
  if (configPath) {
    const absolute = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);
    return existsSync(absolute) ? absolute : null;
  }
  for (const name of CONFIG_CANDIDATES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Dotted-path lookup that traverses both plain objects and arrays indexed by
// numeric segments (so `navigation.0.url` reaches the first nav entry's URL).
// Returns `undefined` when any segment is missing rather than throwing — the
// caller distinguishes "unknown key" from "value present but falsy".
export function lookupDotted(root: Record<string, unknown>, key: string): unknown {
  if (key === '') return undefined;
  let current: unknown = root;
  for (const segment of key.split('.')) {
    if (segment === '') return undefined;
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    const next = (current as Record<string, unknown>)[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

// Plain-text formatter: scalars print bare, arrays/objects fall back to JSON
// so structured values are still readable without --json.
function formatScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}
