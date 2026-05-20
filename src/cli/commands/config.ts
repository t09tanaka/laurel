import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import { loadConfig } from '~/config/loader.ts';
import { reportConfigValidationError, validateConfigOnly } from '../config-validation.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { discoverRcPath } from '../rc.ts';
import { reportError } from '../report.ts';
import { CONFIG_SPEC } from '../specs.ts';

const CONFIG_CANDIDATES = [
  'nectar.toml',
  'nectar.config.toml',
  'nectar.config.json',
  'nectar.config.ts',
  'nectar.config.js',
  'nectar.config.mjs',
  'nectar.config.cjs',
];
const LOCAL_CONFIG_NAME = '.nectar.local.toml';
const JS_CONFIG_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const CONFIG_PRINT_FORMATS = new Set(['json', 'toml']);
type ConfigPrintFormat = 'json' | 'toml';
type ConfigFormat = 'toml' | 'json';

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

  if (sub === 'validate') {
    if (parsed.positionals.length > 1) {
      process.stderr.write('`config validate` takes no further arguments.\n');
      return 2;
    }
    const result = await validateConfigOnly({ cwd, configPath });
    if (!result.ok) {
      if (asJson) {
        process.stdout.write(`${JSON.stringify({ ok: false, errors: [result.entry] })}\n`);
      } else {
        reportConfigValidationError(result, cwd);
      }
      return 1;
    }
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          errors: [],
          site: {
            title: result.config.site.title,
            url: result.config.site.url,
          },
        })}\n`,
      );
    } else {
      process.stdout.write(`Config OK: ${result.config.site.title}\n`);
    }
    return 0;
  }

  if (sub === 'path') {
    if (parsed.positionals.length > 1) {
      process.stderr.write('`config path` takes no further arguments.\n');
      return 2;
    }
    const resolved = resolveConfigPath(cwd, configPath);
    const rcPath = discoverRcPath(cwd);
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify({ config_path: resolved, rc_path: rcPath }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(
        [`Config: ${resolved ?? 'not found'}`, `Project rc: ${rcPath ?? 'not found'}`, ''].join(
          '\n',
        ),
      );
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

  if (sub === 'set') {
    const key = parsed.positionals[1];
    const rawValue = parsed.positionals[2];
    if (!key || rawValue === undefined) {
      process.stderr.write(
        '`config set` requires a dotted key and value (e.g. `site.title "My Site"`).\n',
      );
      return 2;
    }
    if (parsed.positionals.length > 3) {
      process.stderr.write('`config set` takes exactly one dotted key and one value.\n');
      return 2;
    }
    const path = parseDottedKey(key);
    if (!path) {
      process.stderr.write(`Invalid config key: ${key}\n`);
      return 2;
    }
    const value = parseConfigValue(rawValue);
    const target = resolveConfigWriteTarget(cwd, configPath);
    const before = await readExistingFile(target.path);
    try {
      await writeConfigValue(target.path, target.format, path, value);
      await validateWrittenConfig(cwd, configPath, target);
      if (asJson) {
        process.stdout.write(
          `${JSON.stringify(
            { config_path: target.path, key, value, wrote_local_override: target.localOverride },
            null,
            2,
          )}\n`,
        );
      } else if (target.localOverride) {
        process.stdout.write(`Set ${key} in ${target.path} (local TOML override).\n`);
      } else {
        process.stdout.write(`Set ${key} in ${target.path}.\n`);
      }
      return 0;
    } catch (err) {
      await restoreFile(target.path, before);
      reportError(err, cwd);
      return 1;
    }
  }

  process.stderr.write(
    `Unknown subcommand: ${sub ?? '<missing>'}. Expected \`print\`, \`validate\`, \`get <key>\`, \`set <key> <value>\`, or \`path\`.\n`,
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
  return TOML.stringify(config as Parameters<typeof TOML.stringify>[0]);
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

interface ConfigWriteTarget {
  path: string;
  format: ConfigFormat;
  localOverride: boolean;
}

function resolveConfigWriteTarget(cwd: string, configPath: string | undefined): ConfigWriteTarget {
  if (configPath) {
    const explicit = splitConfigPathList(configPath);
    const selected = explicit[explicit.length - 1];
    if (!selected) return tomlTarget(join(cwd, 'nectar.toml'), false);
    return writeTargetForPath(cwd, selected, true);
  }

  const local = join(cwd, LOCAL_CONFIG_NAME);
  if (existsSync(local)) return tomlTarget(local, false);

  for (const name of CONFIG_CANDIDATES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return writeTargetForPath(cwd, candidate, false);
  }
  return tomlTarget(join(cwd, 'nectar.toml'), false);
}

function writeTargetForPath(cwd: string, inputPath: string, explicit: boolean): ConfigWriteTarget {
  const absolute = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
  const ext = extname(absolute).toLowerCase();
  if (JS_CONFIG_EXTENSIONS.has(ext)) {
    return tomlTarget(join(dirname(absolute), LOCAL_CONFIG_NAME), true);
  }
  if (ext === '.json') return { path: absolute, format: 'json', localOverride: false };
  if (ext === '.toml' || explicit) return tomlTarget(absolute, false);
  return tomlTarget(absolute, false);
}

function tomlTarget(path: string, localOverride: boolean): ConfigWriteTarget {
  return { path, format: 'toml', localOverride };
}

function splitConfigPathList(configPath: string): string[] {
  return configPath
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

function parseDottedKey(key: string): string[] | undefined {
  const parts = key.split('.');
  if (parts.length === 0) return undefined;
  if (parts.some((part) => part.length === 0 || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(part))) {
    return undefined;
  }
  return parts;
}

export function parseConfigValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return raw;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return raw;
}

async function readExistingFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  return readFile(path, 'utf8');
}

async function restoreFile(path: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, contents);
}

async function writeConfigValue(
  path: string,
  format: ConfigFormat,
  keyPath: readonly string[],
  value: string | number | boolean,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (format === 'json') {
    await writeJsonConfigValue(path, keyPath, value);
    return;
  }
  await writeTomlConfigValue(path, keyPath, value);
}

async function writeJsonConfigValue(
  path: string,
  keyPath: readonly string[],
  value: string | number | boolean,
): Promise<void> {
  const raw = existsSync(path) ? await readFile(path, 'utf8') : '{}\n';
  const parsed = raw.trim() === '' ? {} : JSON.parse(raw);
  const root =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  setObjectPath(root, keyPath, value);
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`);
}

async function writeTomlConfigValue(
  path: string,
  keyPath: readonly string[],
  value: string | number | boolean,
): Promise<void> {
  const raw = existsSync(path) ? await readFile(path, 'utf8') : '';
  if (raw.trim() !== '') TOML.parse(raw);
  const next = setTomlScalar(raw, keyPath, value);
  await writeFile(path, next);
}

function setObjectPath(
  root: Record<string, unknown>,
  keyPath: readonly string[],
  value: string | number | boolean,
): void {
  let cursor = root;
  for (let i = 0; i < keyPath.length - 1; i += 1) {
    const key = keyPath[i];
    if (key === undefined) break;
    const existing = cursor[key];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      cursor[key] = next;
      cursor = next;
      continue;
    }
    cursor = existing as Record<string, unknown>;
  }
  const leaf = keyPath[keyPath.length - 1];
  if (leaf !== undefined) cursor[leaf] = value;
}

function setTomlScalar(
  raw: string,
  keyPath: readonly string[],
  value: string | number | boolean,
): string {
  const leaf = keyPath[keyPath.length - 1];
  if (!leaf) return raw;
  const sectionPath = keyPath.slice(0, -1);
  const lines = raw.length > 0 ? raw.split(/\n/) : [];
  const hadTrailingNewline = raw.endsWith('\n');
  if (hadTrailingNewline && lines[lines.length - 1] === '') lines.pop();
  const renderedValue = formatTomlValue(value);
  const section = findTomlSection(lines, sectionPath);
  if (section) {
    const existing = findTomlKeyLine(lines, leaf, section.start + 1, section.end);
    if (existing !== undefined) {
      lines[existing] = replaceTomlAssignment(lines[existing] ?? '', leaf, renderedValue);
    } else {
      lines.splice(section.end, 0, `${leaf} = ${renderedValue}`);
    }
  } else if (sectionPath.length === 0) {
    const firstSection = firstTomlSectionIndex(lines);
    const existing = findTomlKeyLine(lines, leaf, 0, firstSection);
    if (existing !== undefined) {
      lines[existing] = replaceTomlAssignment(lines[existing] ?? '', leaf, renderedValue);
    } else {
      lines.splice(firstSection, 0, `${leaf} = ${renderedValue}`);
    }
  } else {
    if (lines.length > 0 && lines[lines.length - 1]?.trim() !== '') lines.push('');
    lines.push(`[${sectionPath.join('.')}]`);
    lines.push(`${leaf} = ${renderedValue}`);
  }
  return `${lines.join('\n')}\n`;
}

function findTomlSection(
  lines: readonly string[],
  sectionPath: readonly string[],
): { start: number; end: number } | undefined {
  if (sectionPath.length === 0) return { start: -1, end: firstTomlSectionIndex(lines) };
  const wanted = sectionPath.join('.');
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseTomlSectionHeader(lines[i] ?? '');
    if (parsed !== wanted) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (parseTomlSectionHeader(lines[j] ?? '') !== undefined) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return undefined;
}

function firstTomlSectionIndex(lines: readonly string[]): number {
  const idx = lines.findIndex((line) => parseTomlSectionHeader(line) !== undefined);
  return idx === -1 ? lines.length : idx;
}

function parseTomlSectionHeader(line: string): string | undefined {
  const match = /^\s*\[([^\]]+)]\s*(?:#.*)?$/.exec(line);
  return match?.[1]?.trim();
}

function findTomlKeyLine(
  lines: readonly string[],
  key: string,
  start: number,
  end: number,
): number | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  for (let i = start; i < end; i += 1) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('#')) continue;
    if (pattern.test(line)) return i;
  }
  return undefined;
}

function replaceTomlAssignment(line: string, key: string, renderedValue: string): string {
  const pattern = new RegExp(`^(\\s*${escapeRegExp(key)}\\s*=\\s*)(.*)$`);
  const match = pattern.exec(line);
  if (!match) return `${key} = ${renderedValue}`;
  return `${match[1]}${renderedValue}${findTomlTrailingComment(match[2] ?? '')}`;
}

function findTomlTrailingComment(valueAndMaybeComment: string): string {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let i = 0; i < valueAndMaybeComment.length; i += 1) {
    const ch = valueAndMaybeComment.charAt(i);
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch === '"' ? '"' : "'";
      continue;
    }
    if (ch === '#') return valueAndMaybeComment.slice(i).replace(/^\s*/, ' ');
  }
  return '';
}

function formatTomlValue(value: string | number | boolean): string {
  const line = TOML.stringify({ value }).trim();
  return line.replace(/^value\s*=\s*/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function validateWrittenConfig(
  cwd: string,
  configPath: string | undefined,
  target: ConfigWriteTarget,
): Promise<void> {
  if (target.localOverride) {
    await loadConfig({ cwd: dirname(target.path), configPath: target.path });
    return;
  }
  await loadConfig({ cwd, configPath: configPath ?? target.path });
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
