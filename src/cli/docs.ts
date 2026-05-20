import { resolve } from 'node:path';
import type { CommandSpec, OptionSpec, PositionalSpec } from './parse.ts';
import { envVarName, formatUsageLine, globalEnvVarName, optionShort } from './parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

export interface GlobalOptionDoc {
  flag: string;
  description: string;
  envVar?: string;
}

export const DEFAULT_GLOBAL_OPTIONS: GlobalOptionDoc[] = [
  {
    flag: '-q, --quiet',
    description: 'Suppress info/debug output (keeps warn/error)',
    envVar: globalEnvVarName('quiet'),
  },
  {
    flag: '-V, --verbose',
    description: 'Increase verbosity to debug (stack `-VV` for trace)',
    envVar: globalEnvVarName('verbose'),
  },
  {
    flag: '-j, --json',
    description:
      'Emit one JSON object per log line (and JSON-shaped output where the command supports it). Also picks up `NECTAR_JSON=1`.',
    envVar: globalEnvVarName('json'),
  },
  {
    flag: '--no-color',
    description:
      'Disable ANSI color output. Also honours the standard `NO_COLOR=1` env var; `FORCE_COLOR=1` overrides.',
    envVar: globalEnvVarName('no-color'),
  },
  {
    flag: '--debug',
    description:
      'Show full stack traces when a command errors out. Default mode prints a short message + hint + docs link; set `NECTAR_DEBUG=1` for the same effect from env.',
    envVar: globalEnvVarName('debug'),
  },
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

  lines.push('## Argument order');
  lines.push('');
  lines.push(
    'Within a subcommand, flags and positional arguments may be interleaved.',
    '`nectar new --slug foo post "Hello"` and `nectar new post --slug foo "Hello"`',
    'parse the same way. `--` still ends option parsing; every following token is',
    'treated as a positional argument, even when it looks like a flag.',
  );
  lines.push('');

  lines.push('## Global options');
  lines.push('');
  lines.push(
    ...renderTable(
      ['Flag', 'Env var', 'Description'],
      globals.map((g) => [code(g.flag), g.envVar ? code(g.envVar) : '—', g.description]),
    ),
  );
  lines.push('');

  lines.push('## Environment variables');
  lines.push('');
  lines.push(
    'Every flag has an env-var fallback so flags can be set without touching the',
    'command line. Useful for `docker-compose`, CI, devcontainers, and `.env` files.',
  );
  lines.push('');
  lines.push(
    '- **Naming:** `NECTAR_<COMMAND>_<FLAG>`, uppercased, with dashes turned into',
    '  underscores. Example: `--port` on `nectar serve` reads from `NECTAR_SERVE_PORT`,',
    '  and `--base-path` on `nectar build` reads from `NECTAR_BUILD_BASE_PATH`.',
    '  Global flags drop the command segment: `NECTAR_QUIET`, `NECTAR_VERBOSE`.',
    '- **Precedence:** CLI flag → env var → config file → built-in default.',
    '- **Boolean values:** `1`, `true`, `yes`, `on` are true; `0`, `false`, `no`,',
    '  `off`, and the empty string are false (case-insensitive). Anything else is',
    '  rejected as a usage error.',
    '- **String values:** used verbatim. An empty string is treated as unset so',
    '  the next layer (config file or default) wins.',
    '- **Verbosity:** `NECTAR_VERBOSE` takes a non-negative integer (`0` = info,',
    '  `1` = debug, `2+` = trace), matching how `-V` / `-VV` stack on the CLI.',
  );
  lines.push('');
  lines.push(
    'Each command section below lists the env-var name for every flag in its',
    '`Env var` column.',
  );
  lines.push('');
  lines.push('## Config discovery and `--config`');
  lines.push('');
  lines.push(
    'Commands with `--config <path>` accept one or more TOML files. Without it, Nectar',
    'checks only the current working directory, first `nectar.toml`, then',
    '`nectar.config.toml`; the first existing file wins. If `NECTAR_ENV` is set,',
    'Nectar then appends `nectar.<env>.toml` when that file exists. If no config',
    'file exists, the config schema defaults are used.',
  );
  lines.push('');
  lines.push(
    'Passing `--config`, or setting the matching env var such as',
    '`NECTAR_BUILD_CONFIG`, disables discovery and `NECTAR_ENV` file selection.',
    'Repeat `--config` or comma-separate paths to load multiple files; later files',
    'deep-merge over earlier files, with arrays and scalar values replaced.',
    'Relative paths are resolved from the process cwd.',
  );
  lines.push('');
  lines.push(
    'The programmatic build API mirrors the loader behaviour through',
    '`build({ cwd, configPath })`, but it does not parse CLI flags or',
    '`NECTAR_<COMMAND>_CONFIG` env vars for you. Pass `configPath` as one path,',
    'a comma-separated list, or an ordered array if you want explicit-file mode.',
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
      ['Flag', 'Type', 'Env var', 'Description'],
      Object.entries(spec.options).map(([name, opt]) => [
        code(formatFlagLabel(name, opt)),
        opt.type,
        code(envVarName(spec.name, name)),
        opt.description,
      ]),
    ),
  );

  if (spec.examples && spec.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    lines.push('');
    lines.push('```');
    for (const ex of spec.examples) lines.push(ex);
    lines.push('```');
  }
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
  const shortName = optionShort(name, opt);
  const short = shortName ? `-${shortName}, ` : '';
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
