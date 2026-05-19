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

const HELP_OPTION: OptionSpec = {
  type: 'boolean',
  short: 'h',
  description: 'Show help for this command',
};

export function parseCommand(spec: CommandSpec, args: string[]): ParsedCommand {
  const options: NonNullable<ParseArgsConfig['options']> = {};
  options.help = { type: HELP_OPTION.type, short: HELP_OPTION.short };
  for (const [name, opt] of Object.entries(spec.options)) {
    if (name === 'help') {
      throw new Error(`Option "help" is reserved and cannot be redefined on "${spec.name}"`);
    }
    options[name] = opt.short ? { type: opt.type, short: opt.short } : { type: opt.type };
  }

  let result: ReturnType<typeof nodeParseArgs>;
  try {
    result = nodeParseArgs({
      args,
      options,
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new CliUsageError(err instanceof Error ? err.message : String(err));
  }

  const positionals = result.positionals as string[];
  const helpRequested = result.values.help === true;
  if (!helpRequested) {
    validatePositionals(spec, positionals);
  }

  return {
    values: result.values as Record<string, string | boolean | undefined>,
    positionals,
    helpRequested,
  };
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
