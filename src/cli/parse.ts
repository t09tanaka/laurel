import { type ParseArgsConfig, parseArgs as nodeParseArgs } from 'node:util';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  description: string;
  placeholder?: string;
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

const HELP_OPTION: OptionSpec = {
  type: 'boolean',
  short: 'h',
  description: 'Show help for this command',
};

export function parseCommand(
  spec: CommandSpec,
  args: string[],
  env: Record<string, string | undefined> = {},
): ParsedCommand {
  const options: NonNullable<ParseArgsConfig['options']> = {};
  options.help = { type: HELP_OPTION.type, short: HELP_OPTION.short };
  const negativeAliases = new Map<string, string>();
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') {
      throw new Error(`Option "help" is reserved and cannot be redefined on "${spec.name}"`);
    }
    options[name] = opt.short ? { type: opt.type, short: opt.short } : { type: opt.type };
    if (opt.type === 'boolean' && !name.startsWith('no-')) {
      const negativeName = `no-${name}`;
      if (!(negativeName in spec.options)) {
        options[negativeName] = { type: 'boolean' };
        negativeAliases.set(negativeName, name);
      }
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

  return {
    values,
    positionals,
    helpRequested,
  };
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
    if (envValue === undefined) continue;
    if (opt.type === 'boolean') {
      values[name] = parseBooleanEnv(envValue, envKey);
    } else if (envValue !== '') {
      values[name] = envValue;
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
  return s.toUpperCase().replace(/-/g, '_');
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
  for (const opt of Object.entries(spec.options)) {
    const [name, def] = opt;
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

export function formatCommandHelp(spec: CommandSpec): string {
  const lines: string[] = [];
  lines.push(spec.summary);
  lines.push('');
  lines.push('Usage:');
  lines.push(`  ${formatUsageLine(spec)}`);

  if (spec.positionals.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    for (const pos of spec.positionals) {
      lines.push(`  ${pad(pos.name, 20)}${pos.description}`);
    }
  }

  lines.push('');
  lines.push('Options:');
  for (const [name, def] of Object.entries(spec.options)) {
    const flag = formatFlag(name, def);
    lines.push(`  ${pad(flag, 20)}${def.description}`);
  }
  lines.push(`  ${pad('-h, --help', 20)}${HELP_OPTION.description}`);

  const firstOption = Object.keys(spec.options)[0];
  if (firstOption !== undefined) {
    lines.push('');
    lines.push('Environment variables:');
    lines.push('  Every flag has an env var fallback (CLI flag > env var > config > default).');
    lines.push('  Naming: NECTAR_<COMMAND>_<FLAG> (uppercased, dashes become underscores).');
    lines.push(`  Example: --${firstOption} → ${envVarName(spec.name, firstOption)}`);
  }

  if (spec.examples && spec.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    for (const ex of spec.examples) {
      lines.push(`  ${ex}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function formatFlag(name: string, def: OptionSpec): string {
  const placeholder = def.type === 'string' ? ` ${def.placeholder ?? '<value>'}` : '';
  const short = def.short ? `-${def.short}, ` : '';
  return `${short}--${name}${placeholder}`;
}

function pad(text: string, width: number): string {
  if (text.length >= width) return `${text}  `;
  return text + ' '.repeat(width - text.length);
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
    if (opt.type === 'boolean' && !name.startsWith('no-')) {
      const negativeName = `no-${name}`;
      if (!(negativeName in spec.options)) {
        names.push(negativeName);
      }
    }
  }
  return names;
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
