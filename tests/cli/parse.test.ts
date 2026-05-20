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
import { BUILD_SPEC, NEW_SPEC } from '~/cli/specs.ts';

const SAMPLE_SPEC: CommandSpec = {
  name: 'build',
  summary: 'Build the site',
  options: {
    config: { type: 'string', description: 'Config path', placeholder: '<path>' },
    watch: { type: 'boolean', short: 'w', default: true, description: 'Rebuild on change' },
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

  test('accepts stable short aliases by option name', () => {
    const spec: CommandSpec = {
      name: 'dev',
      summary: 'Serve locally',
      options: {
        config: { type: 'string', description: 'Config path', placeholder: '<path>' },
        port: { type: 'string', description: 'Port', placeholder: '<n>' },
        output: { type: 'string', description: 'Output path', placeholder: '<dir>' },
        watch: { type: 'boolean', description: 'Watch files' },
        json: { type: 'boolean', description: 'JSON output' },
      },
      positionals: [],
    };
    const result = parseCommand(spec, ['-c', 'alt.toml', '-p', '4310', '-o', 'dist', '-w', '-j']);

    expect(result.values.config).toBe('alt.toml');
    expect(result.values.port).toBe('4310');
    expect(result.values.output).toBe('dist');
    expect(result.values.watch).toBe(true);
    expect(result.values.json).toBe(true);
  });

  test('keeps lower -v reserved for the top-level version command', () => {
    expect(() => parseCommand(SAMPLE_SPEC, ['-v'])).toThrow(CliUsageError);
  });

  test('flags --help via long and short form', () => {
    expect(parseCommand(SAMPLE_SPEC, ['--help']).helpRequested).toBe(true);
    expect(parseCommand(SAMPLE_SPEC, ['-h']).helpRequested).toBe(true);
  });

  test('flags a leading help positional as command help', () => {
    const result = parseCommand(SAMPLE_SPEC, ['help']);
    expect(result.helpRequested).toBe(true);
    expect(result.positionals).toEqual([]);
  });

  test('does not treat option values named help as command help', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config', 'help']);
    expect(result.helpRequested).toBe(false);
    expect(result.values.config).toBe('help');
  });

  test('treats help as command help before required positional validation', () => {
    const result = parseCommand(POSITIONAL_SPEC, ['help']);
    expect(result.helpRequested).toBe(true);
    expect(result.positionals).toEqual([]);
  });

  test('does not treat help after -- as command help', () => {
    expect(() => parseCommand(POSITIONAL_SPEC, ['--', 'help'])).toThrow(
      /Missing required argument/,
    );
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

  test('allows flags before required positionals', () => {
    const result = parseCommand(NEW_SPEC, ['--slug', 'foo', 'post', 'Hello']);
    expect(result.values.slug).toBe('foo');
    expect(result.positionals).toEqual(['post', 'Hello']);
  });

  test('allows flags between positional arguments', () => {
    const result = parseCommand(NEW_SPEC, ['post', '--slug', 'foo', '--draft', 'Hello']);
    expect(result.values.slug).toBe('foo');
    expect(result.values.draft).toBe(true);
    expect(result.positionals).toEqual(['post', 'Hello']);
  });

  test('-- still ends option parsing when positionals and flags are interleaved', () => {
    const result = parseCommand(NEW_SPEC, ['post', '--', '--slug', 'Hello']);
    expect(result.values.slug).toBeUndefined();
    expect(result.positionals).toEqual(['post', '--slug', 'Hello']);
  });

  test('repeated --config values are preserved in order for layered loading', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--config', 'a.toml', '--config', 'b.toml']);
    expect(result.values.config).toBe('a.toml,b.toml');
  });

  test('repeated scalar string flags use the last value', () => {
    const spec: CommandSpec = {
      name: 'build',
      summary: 'Build',
      options: {
        output: { type: 'string', description: 'Output directory', placeholder: '<dir>' },
      },
      positionals: [],
    };
    const result = parseCommand(spec, ['--output', 'dist-a', '--output=dist-b']);
    expect(result.values.output).toBe('dist-b');
  });

  test('repeatable string flags accumulate in argument order', () => {
    const spec: CommandSpec = {
      name: 'content',
      summary: 'List content',
      options: {
        tag: {
          type: 'string',
          description: 'Filter by tag',
          placeholder: '<slug>',
          repeatable: true,
        },
      },
      positionals: [],
    };
    const result = parseCommand(spec, ['--tag', 'news', '--tag=release']);
    expect(result.values.tag).toBe('news,release');
  });

  test('repeated boolean flag stays true', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--watch', '--watch']);
    expect(result.values.watch).toBe(true);
  });

  test('--no-* negates boolean options without requiring an explicit false value', () => {
    const result = parseCommand(SAMPLE_SPEC, ['--no-watch']);
    expect(result.values.watch).toBe(false);
  });

  test('auto-generates --no-* only for default-true boolean options', () => {
    const spec: CommandSpec = {
      name: 'check',
      summary: 'Check',
      options: {
        strict: { type: 'boolean', description: 'Fail on warnings' },
        network: { type: 'boolean', default: true, description: 'Probe network' },
      },
      positionals: [],
    };

    expect(parseCommand(spec, ['--no-network']).values.network).toBe(false);
    expect(() => parseCommand(spec, ['--no-strict'])).toThrow(CliUsageError);
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
      '--no-atomic',
      '--no-progress',
      '--no-cache',
      '--no-copy-content-assets',
      '--no-emit-content-api',
    ]);
    expect(result.values.atomic).toBe(false);
    expect(result.values.progress).toBe(false);
    expect(result.values.cache).toBe(false);
    expect(result.values['copy-content-assets']).toBe(false);
    expect(result.values['emit-content-api']).toBe(false);
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
    expect(help).toContain('-c, --config <path>');
    expect(help).toContain('-w, --watch');
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

  test('generated --no-* flags keep legacy NO_* env fallbacks', () => {
    expect(parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_NO_WATCH: '1' }).values.watch).toBe(false);
    expect(parseCommand(SAMPLE_SPEC, [], { NECTAR_BUILD_NO_WATCH: '0' }).values.watch).toBe(true);
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
    expect(help).toContain('Repeated flags:');
    expect(help).toContain('Scalar string flags use the last value');
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
