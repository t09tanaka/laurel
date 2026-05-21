import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGlobalFlags } from '~/cli/global-flags.ts';

describe('extractGlobalFlags', () => {
  test('returns defaults when no flags are present', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--strict']);
    expect(flags).toEqual({
      quiet: false,
      verboseCount: 0,
      json: false,
      logFormat: undefined,
      noColor: false,
      debug: false,
      warningsAsErrors: false,
      locale: undefined,
    });
    expect(rest).toEqual(['build', '--strict']);
  });

  test('strips --quiet from argv', () => {
    const { flags, rest } = extractGlobalFlags(['--quiet', 'build']);
    expect(flags.quiet).toBe(true);
    expect(rest).toEqual(['build']);
  });

  test('strips -q from argv as the quiet alias', () => {
    const { flags, rest } = extractGlobalFlags(['-q', 'build']);
    expect(flags.quiet).toBe(true);
    expect(rest).toEqual(['build']);
  });

  test('strips --verbose and counts as 1', () => {
    const { flags, rest } = extractGlobalFlags(['--verbose', 'build']);
    expect(flags.verboseCount).toBe(1);
    expect(rest).toEqual(['build']);
  });

  test('-V counts as 1', () => {
    const { flags, rest } = extractGlobalFlags(['-V', 'build']);
    expect(flags.verboseCount).toBe(1);
    expect(rest).toEqual(['build']);
  });

  test('-VV counts as 2 (trace)', () => {
    const { flags, rest } = extractGlobalFlags(['-VV', 'build']);
    expect(flags.verboseCount).toBe(2);
    expect(rest).toEqual(['build']);
  });

  test('-VVV stacks to 3', () => {
    const { flags } = extractGlobalFlags(['-VVV', 'build']);
    expect(flags.verboseCount).toBe(3);
  });

  test('repeated --verbose stacks', () => {
    const { flags } = extractGlobalFlags(['--verbose', '--verbose', 'build']);
    expect(flags.verboseCount).toBe(2);
  });

  test('flags can appear after the command name', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--strict', '-V']);
    expect(flags.verboseCount).toBe(1);
    expect(rest).toEqual(['build', '--strict']);
  });

  test('tokens after -- are not parsed', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--', '--verbose', '-V']);
    expect(flags.verboseCount).toBe(0);
    expect(rest).toEqual(['build', '--', '--verbose', '-V']);
  });

  test('does not strip unrelated flags that contain -V', () => {
    const { flags, rest } = extractGlobalFlags(['new', '-V=something', 'page']);
    expect(flags.verboseCount).toBe(0);
    expect(rest).toEqual(['new', '-V=something', 'page']);
  });
});

describe('extractGlobalFlags env var fallbacks', () => {
  test('NECTAR_QUIET enables quiet mode when CLI did not set it', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_QUIET: '1' });
    expect(flags.quiet).toBe(true);
  });

  test('CLI --quiet takes priority over NECTAR_QUIET=false', () => {
    const { flags } = extractGlobalFlags(['--quiet', 'build'], { NECTAR_QUIET: 'false' });
    expect(flags.quiet).toBe(true);
  });

  test('NECTAR_QUIET=false leaves quiet false', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_QUIET: 'false' });
    expect(flags.quiet).toBe(false);
  });

  test('throws on unparseable NECTAR_QUIET', () => {
    expect(() => extractGlobalFlags(['build'], { NECTAR_QUIET: 'maybe' })).toThrow();
  });

  test('NECTAR_VERBOSE=2 sets verboseCount=2', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_VERBOSE: '2' });
    expect(flags.verboseCount).toBe(2);
  });

  test('CLI -V overrides NECTAR_VERBOSE', () => {
    const { flags } = extractGlobalFlags(['-V', 'build'], { NECTAR_VERBOSE: '3' });
    expect(flags.verboseCount).toBe(1);
  });

  test('NECTAR_VERBOSE=0 is a no-op', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_VERBOSE: '0' });
    expect(flags.verboseCount).toBe(0);
  });

  test('throws on non-integer NECTAR_VERBOSE', () => {
    expect(() => extractGlobalFlags(['build'], { NECTAR_VERBOSE: 'foo' })).toThrow(
      /NECTAR_VERBOSE/,
    );
  });

  test('throws on negative NECTAR_VERBOSE', () => {
    expect(() => extractGlobalFlags(['build'], { NECTAR_VERBOSE: '-1' })).toThrow();
  });

  test('default env source is empty (hermetic)', () => {
    const { flags } = extractGlobalFlags(['build']);
    expect(flags).toEqual({
      quiet: false,
      verboseCount: 0,
      json: false,
      logFormat: undefined,
      noColor: false,
      debug: false,
      warningsAsErrors: false,
      locale: undefined,
    });
  });

  test('--json sets the global flag and is stripped from argv', () => {
    const { flags, rest } = extractGlobalFlags(['config', '--json', 'path']);
    expect(flags.json).toBe(true);
    expect(flags.logFormat).toBe('json');
    // Stripped at the global level; the CLI entrypoint forwards it back
    // into the dispatched subcommand's argv, so per-command parsers still
    // see it via parsed.values.json.
    expect(rest).not.toContain('--json');
    expect(rest).toEqual(['config', 'path']);
  });

  test('-j sets the global json flag and is stripped from argv', () => {
    const { flags, rest } = extractGlobalFlags(['config', '-j', 'path']);
    expect(flags.json).toBe(true);
    expect(flags.logFormat).toBe('json');
    expect(rest).toEqual(['config', 'path']);
  });

  test('--log-format=json sets logger format without enabling command json', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--log-format=json']);
    expect(flags.json).toBe(false);
    expect(flags.logFormat).toBe('json');
    expect(rest).toEqual(['build']);
  });

  test('--log-format pretty accepts a separated value', () => {
    const { flags, rest } = extractGlobalFlags(['--log-format', 'pretty', 'build']);
    expect(flags.logFormat).toBe('pretty');
    expect(rest).toEqual(['build']);
  });

  test('throws on invalid --log-format', () => {
    expect(() => extractGlobalFlags(['--log-format=xml', 'build'])).toThrow(/log-format/);
  });

  test('leaves lower -v for the top-level version command', () => {
    const { flags, rest } = extractGlobalFlags(['-v']);
    expect(flags.verboseCount).toBe(0);
    expect(rest).toEqual(['-v']);
  });

  test('--no-color sets flag and is stripped from argv', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--no-color']);
    expect(flags.noColor).toBe(true);
    expect(rest).toEqual(['build']);
  });

  test('--debug sets flag and is stripped from argv', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--debug']);
    expect(flags.debug).toBe(true);
    expect(rest).toEqual(['build']);
  });

  test('--warnings-as-errors sets flag and is stripped from argv', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--warnings-as-errors']);
    expect(flags.warningsAsErrors).toBe(true);
    expect(rest).toEqual(['build']);
  });

  test('NO_COLOR env (any non-empty value) disables color', () => {
    const { flags } = extractGlobalFlags(['build'], { NO_COLOR: '1' });
    expect(flags.noColor).toBe(true);
  });

  test('NO_COLOR empty string does not disable', () => {
    const { flags } = extractGlobalFlags(['build'], { NO_COLOR: '' });
    expect(flags.noColor).toBe(false);
  });

  test('NECTAR_NO_COLOR=0 re-enables color even if NO_COLOR=1', () => {
    const { flags } = extractGlobalFlags(['build'], { NO_COLOR: '1', NECTAR_NO_COLOR: '0' });
    expect(flags.noColor).toBe(false);
  });

  test('NECTAR_JSON=1 sets json mode', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_JSON: '1' });
    expect(flags.json).toBe(true);
    expect(flags.logFormat).toBe('json');
  });

  test('NECTAR_LOG_FORMAT sets logger format without enabling command json', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_LOG_FORMAT: 'json' });
    expect(flags.json).toBe(false);
    expect(flags.logFormat).toBe('json');
  });

  test('CLI --log-format overrides NECTAR_JSON logger mode while keeping command json', () => {
    const { flags } = extractGlobalFlags(['--log-format=pretty', 'build'], { NECTAR_JSON: '1' });
    expect(flags.json).toBe(true);
    expect(flags.logFormat).toBe('pretty');
  });

  test('throws on invalid NECTAR_LOG_FORMAT', () => {
    expect(() => extractGlobalFlags(['build'], { NECTAR_LOG_FORMAT: 'compact' })).toThrow(
      /NECTAR_LOG_FORMAT/,
    );
  });

  test('NECTAR_DEBUG=true sets debug mode', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_DEBUG: 'true' });
    expect(flags.debug).toBe(true);
  });

  test('NECTAR_WARNINGS_AS_ERRORS=true enables warnings-as-errors mode', () => {
    const { flags } = extractGlobalFlags(['build'], { NECTAR_WARNINGS_AS_ERRORS: 'true' });
    expect(flags.warningsAsErrors).toBe(true);
  });

  test('project .nectarrc supplies global defaults below env and CLI flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-rc-global-'));
    try {
      await writeFile(
        join(dir, '.nectarrc.json'),
        JSON.stringify({ global: { verbose: 2, json: true, 'log-format': 'pretty' } }),
      );
      const fromRc = extractGlobalFlags(['build'], {}, dir).flags;
      expect(fromRc.verboseCount).toBe(2);
      expect(fromRc.json).toBe(true);
      expect(fromRc.logFormat).toBe('pretty');

      const fromEnv = extractGlobalFlags(['build'], { NECTAR_VERBOSE: '1' }, dir).flags;
      expect(fromEnv.verboseCount).toBe(1);

      const fromCli = extractGlobalFlags(['-V', 'build'], { NECTAR_VERBOSE: '3' }, dir).flags;
      expect(fromCli.verboseCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('user global config supplies defaults below project rc, env, and CLI flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-rc-global-project-'));
    const xdg = await mkdtemp(join(tmpdir(), 'nectar-rc-global-user-'));
    try {
      await mkdir(join(xdg, 'nectar'), { recursive: true });
      await writeFile(
        join(xdg, 'nectar/config.json'),
        JSON.stringify({ global: { verbose: 1, locale: 'ja-JP' } }),
      );
      await writeFile(join(dir, '.nectarrc.json'), JSON.stringify({ global: { verbose: 2 } }));
      const flags = extractGlobalFlags(['build'], { XDG_CONFIG_HOME: xdg }, dir).flags;
      expect(flags.verboseCount).toBe(2);
      expect(flags.locale).toBe('ja-JP');

      const fromEnv = extractGlobalFlags(
        ['build'],
        { XDG_CONFIG_HOME: xdg, NECTAR_LOCALE: 'en-US' },
        dir,
      ).flags;
      expect(fromEnv.locale).toBe('en-US');

      const fromCli = extractGlobalFlags(
        ['--locale=fr-FR', 'build'],
        { XDG_CONFIG_HOME: xdg, NECTAR_LOCALE: 'en-US' },
        dir,
      ).flags;
      expect(fromCli.locale).toBe('fr-FR');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(xdg, { recursive: true, force: true });
    }
  });
});
