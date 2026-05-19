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
