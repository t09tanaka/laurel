import { type ParseArgsConfig, parseArgs as nodeParseArgs } from 'node:util';
import { coerceRcValue, commandRcDefaults, hasRcKey, rcValue } from './rc.ts';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  description: string;
  placeholder?: string;
  default?: boolean;
  negatedDescription?: string;
  // Repeatable string options collect every occurrence in argv order and expose
  // the result as a comma-separated string, matching existing CSV-style flags.
  repeatable?: boolean;
}

export interface PositionalSpec {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface CommandSpec {
  name: string;
  summary: string;
  options: Record<string, OptionSpec>;
  positionals: PositionalSpec[];
  // Per-command usage examples rendered as an `Examples:` block in
  // `formatCommandHelp`. Each entry is a complete shell invocation (e.g.
  // `nectar build --strict`) optionally followed by `  # comment` on the same
  // line. Empty / missing → the block is omitted.
  examples?: string[];
}

export interface ParsedCommand {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
  helpRequested: boolean;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

type ParseArgToken = {
  kind: string;
  name?: string;
  value?: string;
};
type ParseArgsOption = NonNullable<ParseArgsConfig['options']>[string];

const HELP_OPTION: OptionSpec = {
  type: 'boolean',
  short: 'h',
  description: 'Show help for this command',
};
const HELP_SHORT = 'h';

export const STABLE_SHORT_FLAG_ALIASES: Readonly<Record<string, string>> = {
  config: 'c',
  port: 'p',
  output: 'o',
  watch: 'w',
  json: 'j',
};

export function optionShort(name: string, def: OptionSpec): string | undefined {
  return def.short ?? STABLE_SHORT_FLAG_ALIASES[name];
}

export function parseCommand(
  spec: CommandSpec,
  args: string[],
  env: Record<string, string | undefined> = {},
  cwd: string = process.cwd(),
): ParsedCommand {
  const options: NonNullable<ParseArgsConfig['options']> = {};
  options.help = { type: HELP_OPTION.type, short: HELP_OPTION.short };
  const negativeAliases = new Map<string, string>();
  const usedShorts = new Map<string, string>([[HELP_SHORT, 'help']]);
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') {
      throw new Error(`Option "help" is reserved and cannot be redefined on "${spec.name}"`);
    }
    const short = optionShort(name, opt);
    if (short !== undefined) {
      const existing = usedShorts.get(short);
      if (existing !== undefined) {
        throw new Error(
          `Short option "-${short}" is assigned to both "${existing}" and "${name}" on "${spec.name}"`,
        );
      }
      usedShorts.set(short, name);
    }
    const optionConfig: ParseArgsOption = short ? { type: opt.type, short } : { type: opt.type };
    if (isRepeatableStringOption(name, opt)) {
      optionConfig.multiple = true;
    }
    options[name] = optionConfig;
    if (hasAutoNegativeAlias(name, opt, spec.options)) {
      const negativeName = `no-${name}`;
      options[negativeName] = { type: 'boolean' };
      negativeAliases.set(negativeName, name);
    }
  }

  let result: ReturnType<typeof nodeParseArgs> & {
    tokens?: ParseArgToken[];
  };
  try {
    result = nodeParseArgs({
      args,
      options,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (err) {
    throw new CliUsageError(formatParseArgsError(err, spec));
  }

  const rawPositionals = result.positionals as string[];
  const positionalHelpRequested = firstPositionalBeforeTerminator(result.tokens ?? []) === 'help';
  const positionals = positionalHelpRequested ? rawPositionals.slice(1) : rawPositionals;
  const helpRequested = result.values.help === true || positionalHelpRequested;
  if (!helpRequested) {
    validatePositionals(spec, positionals);
  }

  const values = result.values as Record<string, string | boolean | undefined>;
  applyNegativeAliases(values, result.tokens ?? [], negativeAliases);
  applyEnvFallbacks(spec, values, env);
  applyRcFallbacks(spec, values, cwd);
  normalizeRepeatableStringValues(spec, values);

  return {
    values,
    positionals,
    helpRequested,
  };
}

function isRepeatableStringOption(name: string, opt: OptionSpec): boolean {
  return opt.type === 'string' && (opt.repeatable === true || name === 'config');
}

function normalizeRepeatableStringValues(
  spec: CommandSpec,
  values: Record<string, string | boolean | string[] | undefined>,
): void {
  for (const [name, opt] of Object.entries(spec.options)) {
    if (!isRepeatableStringOption(name, opt)) continue;
    const value = values[name];
    if (Array.isArray(value)) {
      values[name] = value.join(',');
    }
  }
}

function firstPositionalBeforeTerminator(tokens: ParseArgToken[]): string | undefined {
  for (const token of tokens) {
    if (token.kind === 'option-terminator') return undefined;
    if (token.kind === 'positional') return token.value;
  }
  return undefined;
}

function applyNegativeAliases(
  values: Record<string, string | boolean | undefined>,
  tokens: ParseArgToken[],
  negativeAliases: ReadonlyMap<string, string>,
): void {
  if (negativeAliases.size === 0) return;
  for (const alias of negativeAliases.keys()) {
    delete values[alias];
  }
  for (const token of tokens) {
    if (token.kind !== 'option' || token.name === undefined) continue;
    const target = negativeAliases.get(token.name);
    if (target !== undefined) {
      values[target] = false;
    } else if (negativeAliases.has(`no-${token.name}`)) {
      values[token.name] = true;
    }
  }
}

function applyEnvFallbacks(
  spec: CommandSpec,
  values: Record<string, string | boolean | undefined>,
  env: Record<string, string | undefined>,
): void {
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') continue;
    if (values[name] !== undefined) continue;
    const envKey = envVarName(spec.name, name);
    const envValue = env[envKey];
    if (envValue === undefined) {
      if (hasAutoNegativeAlias(name, opt, spec.options)) {
        const negativeEnvKey = envVarName(spec.name, `no-${name}`);
        const negativeEnvValue = env[negativeEnvKey];
        if (negativeEnvValue === undefined) continue;
        values[name] = !parseBooleanEnv(negativeEnvValue, negativeEnvKey);
      }
      continue;
    }
    if (opt.type === 'boolean') {
      values[name] = parseBooleanEnv(envValue, envKey);
    } else if (envValue !== '') {
      values[name] = envValue;
    }
  }
}

function applyRcFallbacks(
  spec: CommandSpec,
  values: Record<string, string | boolean | undefined>,
  cwd: string,
): void {
  let defaults: ReturnType<typeof commandRcDefaults>;
  try {
    defaults = commandRcDefaults(spec.name, cwd);
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }
  if (defaults === undefined) return;
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') continue;
    if (values[name] !== undefined) continue;
    const source = `.nectarrc ${spec.name}.${name}`;
    if (hasRcKey(defaults, name)) {
      try {
        values[name] = coerceRcValue(rcValue(defaults, name), opt, source);
      } catch (err) {
        throw new CliUsageError(err instanceof Error ? err.message : String(err));
      }
      continue;
    }
    if (!hasAutoNegativeAlias(name, opt, spec.options)) continue;
    const negativeName = `no-${name}`;
    if (!hasRcKey(defaults, negativeName)) continue;
    try {
      values[name] = !coerceRcValue(
        rcValue(defaults, negativeName),
        { ...opt, type: 'boolean' },
        `.nectarrc ${spec.name}.${negativeName}`,
      );
    } catch (err) {
      throw new CliUsageError(err instanceof Error ? err.message : String(err));
    }
  }
}

export function envVarName(commandName: string, flagName: string): string {
  return `NECTAR_${toEnvSegment(commandName)}_${toEnvSegment(flagName)}`;
}

export function globalEnvVarName(flagName: string): string {
  return `NECTAR_${toEnvSegment(flagName)}`;
}

function toEnvSegment(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

const ENV_BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'on']);
const ENV_BOOLEAN_FALSE = new Set(['0', 'false', 'no', 'off', '']);

export function parseBooleanEnv(value: string, envKey: string): boolean {
  const v = value.trim().toLowerCase();
  if (ENV_BOOLEAN_TRUE.has(v)) return true;
  if (ENV_BOOLEAN_FALSE.has(v)) return false;
  throw new CliUsageError(
    `Invalid boolean value for ${envKey}: ${JSON.stringify(value)} (expected one of: 1, 0, true, false, yes, no, on, off)`,
  );
}

function validatePositionals(spec: CommandSpec, positionals: string[]): void {
  const required = spec.positionals.filter((p) => p.required);
  if (positionals.length < required.length) {
    const missing = required[positionals.length];
    throw new CliUsageError(`Missing required argument: <${missing?.name}>`);
  }
  const hasVariadic = spec.positionals.some((p) => p.variadic);
  if (!hasVariadic && positionals.length > spec.positionals.length) {
    const extra = positionals.slice(spec.positionals.length).join(' ');
    throw new CliUsageError(`Unexpected argument: ${extra}`);
  }
}

export function formatUsageLine(spec: CommandSpec): string {
  const parts = [`nectar ${spec.name}`];
  for (const [name, def] of optionEntriesForDisplay(spec)) {
    const placeholder = def.type === 'string' ? ` ${def.placeholder ?? '<value>'}` : '';
    parts.push(`[--${name}${placeholder}]`);
  }
  for (const pos of spec.positionals) {
    const bracket = pos.required ? ['<', '>'] : ['[', ']'];
    const suffix = pos.variadic ? '...' : '';
    parts.push(`${bracket[0]}${pos.name}${suffix}${bracket[1]}`);
  }
  return parts.join(' ');
}

export function formatCommandHelp(spec: CommandSpec, width = helpWidth()): string {
  const lines: string[] = [];
  lines.push(...wrapPlainText(spec.summary, width));
  lines.push('');
  lines.push('Usage:');
  lines.push(...wrapPlainText(formatUsageLine(spec), width, '  ', '  '));

  if (spec.positionals.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    for (const pos of spec.positionals) {
      lines.push(...formatHelpRow(pos.name, pos.description, width));
    }
    lines.push('');
    lines.push('End of options:');
    lines.push(
      ...wrapPlainText(
        '  Use `--` before positional values that start with `-`, for example `nectar new post -- --config`.',
        width,
      ),
    );
  }

  lines.push('');
  lines.push('Options:');
  for (const [name, def] of optionEntriesForDisplay(spec)) {
    const flag = formatFlag(name, def);
    lines.push(...formatHelpRow(flag, def.description, width));
  }
  lines.push(...formatHelpRow('-h, --help', HELP_OPTION.description, width));

  const firstOption = Object.keys(spec.options)[0];
  if (firstOption !== undefined) {
    lines.push('');
    lines.push('Environment variables:');
    lines.push(
      ...wrapPlainText(
        'Every flag has an env var fallback (CLI flag > env var > .nectarrc > config > default).',
        width,
        '  ',
        '  ',
      ),
    );
    lines.push(
      ...wrapPlainText(
        'Naming: NECTAR_<COMMAND>_<FLAG> (uppercased, dashes become underscores).',
        width,
        '  ',
        '  ',
      ),
    );
    lines.push(
      ...wrapPlainText(
        `Example: --${firstOption} → ${envVarName(spec.name, firstOption)}`,
        width,
        '  ',
        '  ',
      ),
    );
    lines.push('');
    lines.push('Repeated flags:');
    lines.push(...wrapPlainText('Scalar string flags use the last value.', width, '  ', '  '));
    lines.push(
      ...wrapPlainText(
        'List-style string flags accumulate as comma-separated values in argv order.',
        width,
        '  ',
        '  ',
      ),
    );
    lines.push(
      ...wrapPlainText(
        'Boolean flags use the last positive or negated spelling.',
        width,
        '  ',
        '  ',
      ),
    );
  }

  if (spec.examples && spec.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    for (const ex of spec.examples) {
      lines.push(...wrapPlainText(ex, width, '  ', '  '));
    }
  }
  lines.push('');
  return lines.join('\n');
}

function formatFlag(name: string, def: OptionSpec): string {
  const placeholder = def.type === 'string' ? ` ${def.placeholder ?? '<value>'}` : '';
  const shortName = optionShort(name, def);
  const short = shortName ? `-${shortName}, ` : '';
  return `${short}--${name}${placeholder}`;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return `${text}  `;
  return text + ' '.repeat(width - text.length);
}

function helpWidth(): number | undefined {
  const columns = process.stdout.columns;
  if (!Number.isInteger(columns) || columns === undefined || columns <= 0) return undefined;
  return Math.max(40, Math.min(columns, 100));
}

function formatHelpRow(label: string, description: string, width: number | undefined): string[] {
  const labelColumnWidth = 20;
  const labelPrefix = '  ';
  const descriptionPrefix = labelPrefix + ' '.repeat(labelColumnWidth + 2);
  const paddedLabel = `${labelPrefix}${pad(label, labelColumnWidth)}`;
  if (width === undefined) return [`${paddedLabel}${description}`];
  if (paddedLabel.length >= width - 8) {
    return [paddedLabel.trimEnd(), ...wrapPlainText(description, width, descriptionPrefix)];
  }
  return wrapPlainText(description, width, paddedLabel, descriptionPrefix);
}

function wrapPlainText(
  text: string,
  width: number | undefined,
  firstPrefix = '',
  restPrefix = firstPrefix,
): string[] {
  const expanded = text.replace(/\t/g, '  ');
  if (width === undefined || firstPrefix.length + expanded.length <= width) {
    return [`${firstPrefix}${expanded}`];
  }

  const words = expanded.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [firstPrefix.trimEnd()];

  const lines: string[] = [];
  let prefix = firstPrefix;
  let current = prefix;
  for (const word of words) {
    const separator = current === prefix ? '' : ' ';
    if (`${current}${separator}${word}`.length <= width) {
      current = `${current}${separator}${word}`;
      continue;
    }
    if (current !== prefix) lines.push(current);
    prefix = restPrefix;
    current = `${prefix}${word}`;
    while (current.length > width && width > prefix.length + 8) {
      lines.push(current.slice(0, width));
      current = `${prefix}${current.slice(width).trimStart()}`;
    }
  }
  lines.push(current);
  return lines;
}

// Wrap node:util parseArgs errors so unknown-flag failures include a did-you-mean
// suggestion (Levenshtein over the spec's known flags). Other strict-mode errors
// (missing value, unexpected positional outside our reach, …) pass through with
// their original wording so we don't paper over diagnostics we didn't expect.
function formatParseArgsError(err: unknown, spec: CommandSpec): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  if (code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return err.message;
  const unknownFlag = extractUnknownFlag(err.message);
  if (!unknownFlag) return err.message;
  const knownFlags = collectKnownFlagNames(spec);
  const stripped = unknownFlag.replace(/^-+/, '').replace(/=.*$/, '');
  const suggestion = suggestFlag(stripped, knownFlags);
  const lines = [`Unknown option: ${unknownFlag} (on \`nectar ${spec.name}\`)`];
  if (suggestion) {
    lines.push(`Did you mean --${suggestion}?`);
  }
  if (knownFlags.length > 0) {
    lines.push(`Known flags: ${knownFlags.map((n) => `--${n}`).join(', ')}, --help`);
  }
  return lines.join('\n');
}

function extractUnknownFlag(message: string): string | undefined {
  const m = /Unknown option '(-{1,2}[^']+)'/.exec(message);
  return m?.[1];
}

function collectKnownFlagNames(spec: CommandSpec): string[] {
  const names: string[] = [];
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') continue;
    names.push(name);
    if (hasAutoNegativeAlias(name, opt, spec.options)) {
      names.push(`no-${name}`);
    }
  }
  return names;
}

function hasAutoNegativeAlias(
  name: string,
  opt: OptionSpec,
  options: Readonly<Record<string, OptionSpec>>,
): boolean {
  return (
    opt.type === 'boolean' &&
    opt.default === true &&
    !name.startsWith('no-') &&
    !(`no-${name}` in options)
  );
}

export function optionEntriesForDisplay(spec: CommandSpec): Array<[string, OptionSpec]> {
  const entries: Array<[string, OptionSpec]> = [];
  for (const [name, opt] of Object.entries(spec.options)) {
    entries.push([name, opt]);
    if (!hasAutoNegativeAlias(name, opt, spec.options)) continue;
    entries.push([
      `no-${name}`,
      {
        type: 'boolean',
        description: opt.negatedDescription ?? `Disable --${name}`,
      },
    ]);
  }
  return entries;
}

export function suggestCommand(unknown: string, known: readonly string[]): string | undefined {
  if (!unknown) return undefined;
  let best: { name: string; distance: number } | undefined;
  for (const candidate of known) {
    const distance = levenshtein(unknown, candidate);
    if (!best || distance < best.distance) {
      best = { name: candidate, distance };
    }
  }
  if (!best) return undefined;
  const threshold = Math.max(1, Math.floor(unknown.length / 2));
  return best.distance <= threshold ? best.name : undefined;
}

// Tighter threshold than `suggestCommand` because flag names are short and a
// 6-character flag with distance 3 (half its length) is almost certainly noise.
// Caps the edit distance at 2 so we only volunteer obvious typo corrections.
export function suggestFlag(unknown: string, known: readonly string[]): string | undefined {
  if (!unknown) return undefined;
  let best: { name: string; distance: number } | undefined;
  for (const candidate of known) {
    const distance = levenshtein(unknown, candidate);
    if (!best || distance < best.distance) {
      best = { name: candidate, distance };
    }
  }
  if (!best) return undefined;
  return best.distance <= 2 ? best.name : undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}
