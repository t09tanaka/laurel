import { describe, expect, test } from 'bun:test';
import {
  EXIT_CODES,
  NectarError,
  exitCodeForError,
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

describe('exitCodeForError', () => {
  test('maps each NectarErrorCode to its reserved exit code', () => {
    expect(exitCodeForError(new NectarError({ message: 'c', code: 'config' }))).toBe(
      EXIT_CODES.config,
    );
    expect(exitCodeForError(new NectarError({ message: 'c', code: 'content' }))).toBe(
      EXIT_CODES.content,
    );
    expect(exitCodeForError(new NectarError({ message: 'c', code: 'theme' }))).toBe(
      EXIT_CODES.theme,
    );
    expect(exitCodeForError(new NectarError({ message: 'c', code: 'render' }))).toBe(
      EXIT_CODES.render,
    );
    expect(exitCodeForError(new NectarError({ message: 'c', code: 'emit' }))).toBe(EXIT_CODES.emit);
  });

  test('untagged NectarError falls back to generic (1)', () => {
    expect(exitCodeForError(new NectarError({ message: 'no code' }))).toBe(EXIT_CODES.generic);
  });

  test('plain Error and non-Error values fall back to generic (1)', () => {
    expect(exitCodeForError(new Error('plain'))).toBe(EXIT_CODES.generic);
    expect(exitCodeForError('string')).toBe(EXIT_CODES.generic);
    expect(exitCodeForError(undefined)).toBe(EXIT_CODES.generic);
  });

  test('reserved exit-code table is stable', () => {
    expect(EXIT_CODES).toEqual({
      ok: 0,
      generic: 1,
      usage: 2,
      config: 3,
      content: 4,
      theme: 5,
      render: 6,
      emit: 7,
      sigint: 130,
    });
  });
});

describe('toNectarError preserves code', () => {
  test('keeps code when augmenting with file', () => {
    const original = new NectarError({ message: 'x', code: 'content' });
    const wrapped = toNectarError(original, { file: '/repo/a.md' });
    expect(wrapped).not.toBe(original);
    expect(wrapped.code).toBe('content');
    expect(wrapped.file).toBe('/repo/a.md');
  });

  test('plain Error wrapped without a code stays untagged', () => {
    const wrapped = toNectarError(new Error('boom'), { file: '/repo/x.md' });
    expect(wrapped.code).toBeUndefined();
  });
});

describe('NectarError docsUrl', () => {
  test('stores and exposes docsUrl', () => {
    const err = new NectarError({
      message: 'theme/missing',
      docsUrl: 'https://nectar.dev/docs/theme',
    });
    expect(err.docsUrl).toBe('https://nectar.dev/docs/theme');
  });

  test('formatNectarError prints a docs: line when set', () => {
    const err = new NectarError({
      message: 'oops',
      file: '/repo/x.md',
      line: 1,
      hint: 'fix it',
      docsUrl: 'https://nectar.dev/docs/x',
    });
    const out = formatNectarError(err, { cwd: '/repo' });
    expect(out).toContain('hint: fix it');
    expect(out).toContain('docs: https://nectar.dev/docs/x');
  });

  test('formatNectarError omits docs: line when unset', () => {
    const err = new NectarError({ message: 'oops', file: '/repo/x.md', line: 1, hint: 'fix it' });
    const out = formatNectarError(err, { cwd: '/repo' });
    expect(out).not.toContain('docs:');
  });

  test('toNectarError preserves docsUrl', () => {
    const original = new NectarError({ message: 'x', docsUrl: 'https://a.b/c' });
    const wrapped = toNectarError(original, { file: '/repo/y.md' });
    expect(wrapped.docsUrl).toBe('https://a.b/c');
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
