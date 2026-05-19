import { resolve } from 'node:path';
import type { CommandSpec, OptionSpec, PositionalSpec } from './parse.ts';
import { formatUsageLine } from './parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

export interface GlobalOptionDoc {
  flag: string;
  description: string;
}

export const DEFAULT_GLOBAL_OPTIONS: GlobalOptionDoc[] = [
  { flag: '--quiet', description: 'Suppress info/debug output (keeps warn/error)' },
  { flag: '-V, --verbose', description: 'Increase verbosity to debug (stack `-VV` for trace)' },
  { flag: '-h, --help', description: 'Show help for the top-level CLI or any subcommand' },
  { flag: '-v, --version', description: 'Print the Nectar version and exit' },
];

const AUTOGEN_BANNER =
  '<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:cli`. -->';

export interface RenderOptions {
  globals?: GlobalOptionDoc[];
}

export function renderCliReference(
  specs: Record<string, CommandSpec> = COMMAND_SPECS,
  order: readonly string[] = COMMAND_NAMES,
  options: RenderOptions = {},
): string {
  const globals = options.globals ?? DEFAULT_GLOBAL_OPTIONS;
  const lines: string[] = [];

  lines.push('# Nectar CLI reference');
  lines.push('');
  lines.push(AUTOGEN_BANNER);
  lines.push('');
  lines.push(
    'This page lists every `nectar` subcommand, flag, and positional argument.',
    'It is generated from the command specs in `src/cli/specs.ts`; run',
    '`bun run docs:cli` after changing a spec to refresh it.',
  );
  lines.push('');
  lines.push('## Synopsis');
  lines.push('');
  lines.push('```');
  lines.push('nectar [global options] <command> [options]');
  lines.push('```');
  lines.push('');

  lines.push('## Global options');
  lines.push('');
  lines.push(
    ...renderTable(
      ['Flag', 'Description'],
      globals.map((g) => [code(g.flag), g.description]),
    ),
  );
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push(...renderCommandIndex(specs, order));
  lines.push('');

  for (const name of order) {
    const spec = specs[name];
    if (!spec) continue;
    lines.push(...renderCommandSection(spec));
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('');
  return lines.join('\n');
}

function renderCommandIndex(
  specs: Record<string, CommandSpec>,
  order: readonly string[],
): string[] {
  const rows: string[][] = [];
  for (const name of order) {
    const spec = specs[name];
    if (!spec) continue;
    const anchor = `#nectar-${anchorize(name)}`;
    rows.push([`[\`nectar ${name}\`](${anchor})`, spec.summary]);
  }
  return renderTable(['Command', 'Summary'], rows);
}

function renderCommandSection(spec: CommandSpec): string[] {
  const lines: string[] = [];
  lines.push(`### \`nectar ${spec.name}\``);
  lines.push('');
  lines.push(spec.summary);
  lines.push('');
  lines.push('Usage:');
  lines.push('');
  lines.push('```');
  lines.push(formatUsageLine(spec));
  lines.push('```');

  if (spec.positionals.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    lines.push('');
    lines.push(
      ...renderTable(
        ['Name', 'Required', 'Description'],
        spec.positionals.map((p) => [code(positionalLabel(p)), requiredLabel(p), p.description]),
      ),
    );
  }

  lines.push('');
  lines.push('Options:');
  lines.push('');
  lines.push(
    ...renderTable(
      ['Flag', 'Type', 'Description'],
      Object.entries(spec.options).map(([name, opt]) => [
        code(formatFlagLabel(name, opt)),
        opt.type,
        opt.description,
      ]),
    ),
  );
  return lines;
}

function positionalLabel(p: PositionalSpec): string {
  const brackets = p.required ? ['<', '>'] : ['[', ']'];
  const suffix = p.variadic ? '...' : '';
  return `${brackets[0]}${p.name}${suffix}${brackets[1]}`;
}

function requiredLabel(p: PositionalSpec): string {
  if (p.required && p.variadic) return 'required (variadic)';
  if (p.required) return 'required';
  if (p.variadic) return 'optional (variadic)';
  return 'optional';
}

function formatFlagLabel(name: string, opt: OptionSpec): string {
  const short = opt.short ? `-${opt.short}, ` : '';
  const placeholder = opt.type === 'string' ? ` ${opt.placeholder ?? '<value>'}` : '';
  return `${short}--${name}${placeholder}`;
}

function renderTable(headers: string[], rows: string[][]): string[] {
  const lines: string[] = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return lines;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function code(text: string): string {
  return `\`${text}\``;
}

function anchorize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

if (import.meta.main) {
  const target = resolve(import.meta.dir, '../../docs/cli.md');
  const markdown = renderCliReference();
  await Bun.write(target, markdown);
  process.stdout.write(`Wrote ${target}\n`);
}
