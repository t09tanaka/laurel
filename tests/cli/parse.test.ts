import { describe, expect, test } from 'bun:test';
import {
  CliUsageError,
  type CommandSpec,
  formatCommandHelp,
  formatUsageLine,
  parseCommand,
  suggestCommand,
} from '~/cli/parse.ts';

const SAMPLE_SPEC: CommandSpec = {
  name: 'build',
  summary: 'Build the site',
  options: {
    config: { type: 'string', description: 'Config path', placeholder: '<path>' },
    watch: { type: 'boolean', short: 'w', description: 'Rebuild on change' },
  },
  positionals: [],
};

const POSITIONAL_SPEC: CommandSpec = {
  name: 'new',
  summary: 'Scaffold a new post or page',
  options: {},
  positionals: [
    { name: 'kind', description: 'post or page', required: true },
    { name: 'title', description: 'Title', required: true, variadic: true },
  ],
};

describe('parseCommand', () => {
  test('parses string and boolean options', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config', 'nectar.toml', '--watch']);
    expect(result.values.config).toBe('nectar.toml');
    expect(result.values.watch).toBe(true);
    expect(result.helpRequested).toBe(false);
  });

  test('accepts --key=value form for string options', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config=./nectar.config.ts', '--watch']);
    expect(result.values.config).toBe('./nectar.config.ts');
    expect(result.values.watch).toBe(true);
  });

  test('--key value and --key=value resolve to identical values', () => {
    const space = parseCommand(SAMPLE_SPEC, ['--config', 'a=b/c.toml']);
    const equals = parseCommand(SAMPLE_SPEC, ['--config=a=b/c.toml']);
    expect(equals.values.config).toBe(space.values.config);
    expect(equals.values.config).toBe('a=b/c.toml');
  });

  test('accepts short flags', () => {
    const result = parseCommand(SAMPLE_SPEC, ['-w']);
    expect(result.values.watch).toBe(true);
  });

  test('flags --help via long and short form', () => {
    expect(parseCommand(SAMPLE_SPEC, ['--help']).helpRequested).toBe(true);
    expect(parseCommand(SAMPLE_SPEC, ['-h']).helpRequested).toBe(true);
  });

  test('throws CliUsageError on unknown option', () => {
    expect(() => parseCommand(SAMPLE_SPEC, ['--unknown'])).toThrow(CliUsageError);
  });

  test('throws CliUsageError when required positional is missing', () => {
    expect(() => parseCommand(POSITIONAL_SPEC, ['post'])).toThrow(/Missing required argument/);
  });

  test('collects variadic trailing positionals', () => {
    const result = parseCommand(POSITIONAL_SPEC, ['post', 'Hello', 'World']);
    expect(result.positionals).toEqual(['post', 'Hello', 'World']);
  });

  test('rejects extra positionals when not variadic', () => {
    const spec: CommandSpec = {
      name: 'import-ghost',
      summary: 'Import',
      options: {},
      positionals: [{ name: 'file', description: 'Path', required: true }],
    };
    expect(() => parseCommand(spec, ['a.json', 'b.json'])).toThrow(/Unexpected argument/);
  });

  test('skips positional validation when --help is set', () => {
    const result = parseCommand(POSITIONAL_SPEC, ['--help']);
    expect(result.helpRequested).toBe(true);
  });
});

describe('formatUsageLine', () => {
  test('renders options and positionals with brackets', () => {
    const usage = formatUsageLine(POSITIONAL_SPEC);
    expect(usage).toBe('nectar new <kind> <title...>');
  });

  test('uses placeholder for string options', () => {
    const usage = formatUsageLine(SAMPLE_SPEC);
    expect(usage).toContain('[--config <path>]');
    expect(usage).toContain('[--watch]');
  });
});

describe('formatCommandHelp', () => {
  test('includes summary, usage, options, and --help line', () => {
    const help = formatCommandHelp(SAMPLE_SPEC);
    expect(help).toContain('Build the site');
    expect(help).toContain('Usage:');
    expect(help).toContain('nectar build');
    expect(help).toContain('--config <path>');
    expect(help).toContain('-h, --help');
  });

  test('lists positional arguments when present', () => {
    const help = formatCommandHelp(POSITIONAL_SPEC);
    expect(help).toContain('Arguments:');
    expect(help).toContain('kind');
    expect(help).toContain('title');
  });
});

describe('suggestCommand', () => {
  test('suggests close match', () => {
    expect(suggestCommand('buld', ['build', 'serve', 'check'])).toBe('build');
    expect(suggestCommand('serv', ['build', 'serve', 'check'])).toBe('serve');
  });

  test('returns undefined when nothing is close', () => {
    expect(suggestCommand('xyz', ['build', 'serve'])).toBeUndefined();
  });

  test('returns undefined on empty input', () => {
    expect(suggestCommand('', ['build'])).toBeUndefined();
  });
});
