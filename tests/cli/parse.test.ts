import { describe, expect, test } from 'bun:test';
import {
  CliUsageError,
  type CommandSpec,
  envVarName,
  formatCommandHelp,
  formatUsageLine,
  globalEnvVarName,
  parseBooleanEnv,
  parseCommand,
  suggestCommand,
  suggestFlag,
} from '~/cli/parse.ts';
import { BUILD_SPEC } from '~/cli/specs.ts';

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

  test('unknown-option error includes did-you-mean for close typos', () => {
    try {
      parseCommand(SAMPLE_SPEC, ['--conifg', 'x']);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      const message = err instanceof Error ? err.message : '';
      expect(message).toContain('Unknown option: --conifg');
      expect(message).toContain('Did you mean --config?');
      expect(message).toContain('Known flags:');
    }
  });

  test('unknown-option error lists known flags when no close match', () => {
    try {
      parseCommand(SAMPLE_SPEC, ['--totally-unrelated']);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      const message = err instanceof Error ? err.message : '';
      expect(message).toContain('Unknown option: --totally-unrelated');
      expect(message).not.toContain('Did you mean');
      expect(message).toContain('--config');
      expect(message).toContain('--watch');
    }
  });

  test('unknown short flag also surfaces a usage error', () => {
    try {
      parseCommand(SAMPLE_SPEC, ['-x']);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      expect(err instanceof Error ? err.message : '').toContain('Unknown option');
    }
  });

  test('-- ends option parsing; trailing tokens become positionals', () => {
    const result = parseCommand(POSITIONAL_SPEC, ['post', '--', '--not-a-flag', 'My Title']);
    expect(result.positionals).toEqual(['post', '--not-a-flag', 'My Title']);
  });

  test('repeated string flag keeps the last value (node:util semantics)', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config', 'a.toml', '--config', 'b.toml']);
    expect(result.values.config).toBe('b.toml');
  });

  test('repeated boolean flag stays true', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--watch', '--watch']);
    expect(result.values.watch).toBe(true);
  });

  test('--no-* negates boolean options without requiring an explicit false value', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--no-watch']);
    expect(result.values.watch).toBe(false);
  });

  test('the last positive or negated boolean spelling wins', () => {
    expect(parseCommand(SAMPLE_SPEC, ['--no-watch', '--watch']).values.watch).toBe(true);
    expect(parseCommand(SAMPLE_SPEC, ['--watch', '--no-watch']).values.watch).toBe(false);
  });

  test('exact no-* option names keep their legacy positive meaning', () => {
    const spec: CommandSpec = {
      name: 'serve',
      summary: 'Serve',
      options: {
        'no-watch': { type: 'boolean', description: 'Disable watching' },
      },
      positionals: [],
    };
    const result = parseCommand(spec, ['--no-watch']);
    expect(result.values['no-watch']).toBe(true);
  });

  test('documented build negations parse as false boolean overrides', () => {
    const result = parseCommand(BUILD_SPEC, [
      '--no-progress',
      '--no-cache',
      '--no-copy-content-assets',
      '--no-watch',
    ]);
    expect(result.values.progress).toBe(false);
    expect(result.values.cache).toBe(false);
    expect(result.values['copy-content-assets']).toBe(false);
    expect(result.values.watch).toBe(false);
  });

  test('rejects --no-* for non-boolean options', () => {
    expect(() => parseCommand(SAMPLE_SPEC, ['--no-config'])).toThrow(CliUsageError);
  });

  test('rejects unknown --no-* options', () => {
    expect(() => parseCommand(SAMPLE_SPEC, ['--no-bogus'])).toThrow(CliUsageError);
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

describe('parseCommand env var fallbacks', () => {
  test('fills missing string flag from NECTAR_<COMMAND>_<FLAG>', () => {
    const result = parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_CONFIG: 'env.toml' });
    expect(result.values.config).toBe('env.toml');
  });

  test('CLI flag overrides env var', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config', 'cli.toml'], {
      NECTAR_BUILD_CONFIG: 'env.toml',
    });
    expect(result.values.config).toBe('cli.toml');
  });

  test('boolean env var accepts the documented truthy spellings', () => {
    for (const truthy of ['1', 'true', 'yes', 'on', 'TRUE', 'On', ' yes ']) {
      const result = parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_WATCH: truthy });
      expect(result.values.watch).toBe(true);
    }
  });

  test('boolean env var accepts the documented falsy spellings', () => {
    for (const falsy of ['0', 'false', 'no', 'off', '', 'NO']) {
      const result = parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_WATCH: falsy });
      expect(result.values.watch).toBe(false);
    }
  });

  test('throws CliUsageError on an unparseable boolean env var', () => {
    expect(() => parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_WATCH: 'maybe' })).toThrow(
      CliUsageError,
    );
  });

  test('dashed flag names map to underscored env var names', () => {
    const spec: CommandSpec = {
      name: 'import-ghost',
      summary: 'Import',
      options: { 'on-conflict': { type: 'string', description: 'conflict mode' } },
      positionals: [],
    };
    const result = parseCommand(spec, [], { NECTAR_IMPORT_GHOST_ON_CONFLICT: 'overwrite' });
    expect(result.values['on-conflict']).toBe('overwrite');
  });

  test('empty string env var is treated as not set for string options', () => {
    const result = parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_CONFIG: '' });
    expect(result.values.config).toBeUndefined();
  });

  test('default env source is empty (hermetic)', () => {
    const result = parseCommand(SAMPLE_SPEC, []);
    expect(result.values.config).toBeUndefined();
    expect(result.values.watch).toBeUndefined();
  });

  test('unrelated env vars are ignored', () => {
    const result = parseCommand(SAMPLE_SPEC, [], {
      NECTAR_SERVE_PORT: '9999',
      PATH: '/usr/bin',
    });
    expect(result.values.config).toBeUndefined();
    expect(result.values.watch).toBeUndefined();
  });
});

describe('envVarName / globalEnvVarName', () => {
  test('uppercases and converts dashes to underscores', () => {
    expect(envVarName('serve', 'port')).toBe('NECTAR_SERVE_PORT');
    expect(envVarName('build', 'base-path')).toBe('NECTAR_BUILD_BASE_PATH');
    expect(envVarName('import-ghost', 'on-conflict')).toBe('NECTAR_IMPORT_GHOST_ON_CONFLICT');
    expect(envVarName('serve', 'no-watch')).toBe('NECTAR_SERVE_NO_WATCH');
  });

  test('globalEnvVarName drops the command segment', () => {
    expect(globalEnvVarName('quiet')).toBe('NECTAR_QUIET');
    expect(globalEnvVarName('verbose')).toBe('NECTAR_VERBOSE');
  });
});

describe('parseBooleanEnv', () => {
  test('rejects unknown values with a clear CliUsageError message', () => {
    try {
      parseBooleanEnv('maybe', 'NECTAR_X');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      const message = err instanceof Error ? err.message : '';
      expect(message).toContain('NECTAR_X');
      expect(message).toContain('maybe');
    }
  });
});

describe('formatCommandHelp env footer', () => {
  test('mentions the env var convention with a per-command example', () => {
    const help = formatCommandHelp(SAMPLE_SPEC);
    expect(help).toContain('Environment variables:');
    expect(help).toContain('NECTAR_<COMMAND>_<FLAG>');
    expect(help).toContain('--config → NECTAR_BUILD_CONFIG');
  });

  test('omits env section when the command has no options', () => {
    const spec: CommandSpec = {
      name: 'noop',
      summary: 'do nothing',
      options: {},
      positionals: [],
    };
    const help = formatCommandHelp(spec);
    expect(help).not.toContain('Environment variables:');
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

describe('suggestFlag', () => {
  test('suggests close (<=2 edits) matches', () => {
    expect(suggestFlag('conifg', ['config', 'watch'])).toBe('config');
    expect(suggestFlag('hep', ['help', 'config'])).toBe('help');
    expect(suggestFlag('prot', ['port', 'host'])).toBe('port');
  });

  test('refuses distant matches even when the flag name is long', () => {
    expect(suggestFlag('include-foo', ['include-drafts', 'check-links'])).toBeUndefined();
  });

  test('returns undefined on empty input or empty candidates', () => {
    expect(suggestFlag('', ['config'])).toBeUndefined();
    expect(suggestFlag('config', [])).toBeUndefined();
  });
});
