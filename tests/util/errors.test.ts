import { describe, expect, test } from 'bun:test';
import {
  NectarError,
  formatNectarError,
  isNectarError,
  levenshtein,
  suggestClosest,
  toNectarError,
} from '~/util/errors.ts';

describe('NectarError', () => {
  test('stores file/line/col/hint and message', () => {
    const err = new NectarError({
      message: "unknown field 'visibilty'",
      file: '/abs/content/posts/foo.md',
      line: 3,
      col: 5,
      hint: "did you mean 'visibility'?",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NectarError');
    expect(err.file).toBe('/abs/content/posts/foo.md');
    expect(err.line).toBe(3);
    expect(err.col).toBe(5);
    expect(err.hint).toBe("did you mean 'visibility'?");
    expect(err.message).toBe("unknown field 'visibilty'");
  });

  test('isNectarError narrows correctly', () => {
    const err = new NectarError({ message: 'x' });
    expect(isNectarError(err)).toBe(true);
    expect(isNectarError(new Error('plain'))).toBe(false);
    expect(isNectarError('string')).toBe(false);
  });
});

describe('formatNectarError', () => {
  test('renders Cargo-style pointer with file:line:col and hint', () => {
    const err = new NectarError({
      message: "unknown field 'visibilty'",
      file: '/repo/content/posts/foo.md',
      line: 3,
      col: 5,
      hint: "did you mean 'visibility'?",
    });
    const out = formatNectarError(err, { cwd: '/repo' });
    expect(out).toContain('---- content/posts/foo.md:3:5 - ');
    expect(out).toContain("unknown field 'visibilty'");
    expect(out).toContain("hint: did you mean 'visibility'?");
  });

  test('omits col when only line is known', () => {
    const err = new NectarError({
      message: 'invalid frontmatter: bad indentation',
      file: '/repo/x.md',
      line: 7,
    });
    const out = formatNectarError(err, { cwd: '/repo' });
    expect(out).toBe('---- x.md:7 - invalid frontmatter: bad indentation');
  });

  test('falls back to message-only when no file is known', () => {
    const err = new NectarError({ message: 'something bad' });
    expect(formatNectarError(err)).toBe('---- something bad');
  });

  test('keeps absolute path when cwd is unrelated', () => {
    const err = new NectarError({ message: 'oops', file: '/elsewhere/x.md', line: 1 });
    const out = formatNectarError(err, { cwd: '/repo' });
    expect(out).toContain('/elsewhere/x.md:1');
  });
});

describe('toNectarError', () => {
  test('wraps a plain error with file context', () => {
    const wrapped = toNectarError(new Error('boom'), { file: '/repo/x.md' });
    expect(wrapped).toBeInstanceOf(NectarError);
    expect(wrapped.file).toBe('/repo/x.md');
    expect(wrapped.message).toBe('boom');
  });

  test('preserves an existing NectarError unchanged when file already matches', () => {
    const original = new NectarError({ message: 'x', file: '/repo/a.md', line: 2 });
    const wrapped = toNectarError(original, { file: '/repo/a.md' });
    expect(wrapped).toBe(original);
  });

  test('augments NectarError with file when missing', () => {
    const original = new NectarError({ message: 'x' });
    const wrapped = toNectarError(original, { file: '/repo/a.md' });
    expect(wrapped).not.toBe(original);
    expect(wrapped.file).toBe('/repo/a.md');
    expect(wrapped.message).toBe('x');
  });
});

describe('levenshtein and suggestClosest', () => {
  test('levenshtein basic distances', () => {
    expect(levenshtein('cat', 'cat')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('visibilty', 'visibility')).toBe(1);
  });

  test('suggestClosest returns nearest within threshold', () => {
    expect(suggestClosest('visibilty', ['visibility', 'status', 'title'])).toBe('visibility');
  });

  test('suggestClosest returns undefined when nothing is close', () => {
    expect(suggestClosest('xyzzy', ['visibility', 'status'])).toBeUndefined();
  });
});
