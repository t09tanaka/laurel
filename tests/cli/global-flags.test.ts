import { describe, expect, test } from 'bun:test';
import { extractGlobalFlags } from '~/cli/global-flags.ts';

describe('extractGlobalFlags', () => {
  test('returns defaults when no flags are present', () => {
    const { flags, rest } = extractGlobalFlags(['build', '--strict']);
    expect(flags).toEqual({ quiet: false, verboseCount: 0 });
    expect(rest).toEqual(['build', '--strict']);
  });

  test('strips --quiet from argv', () => {
    const { flags, rest } = extractGlobalFlags(['--quiet', 'build']);
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
    expect(flags).toEqual({ quiet: false, verboseCount: 0 });
  });
});
