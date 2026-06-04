import { describe, expect, test } from 'bun:test';
import {
  EXIT_CODES,
  LaurelError,
  exitCodeForError,
  formatLaurelError,
  isLaurelError,
  levenshtein,
  suggestClosest,
  toLaurelError,
} from '~/util/errors.ts';

describe('LaurelError', () => {
  test('stores file/line/col/hint and message', () => {
    const err = new LaurelError({
      message: "unknown field 'visibilty'",
      file: '/abs/content/posts/foo.md',
      line: 3,
      col: 5,
      hint: "did you mean 'visibility'?",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LaurelError');
    expect(err.file).toBe('/abs/content/posts/foo.md');
    expect(err.line).toBe(3);
    expect(err.col).toBe(5);
    expect(err.hint).toBe("did you mean 'visibility'?");
    expect(err.message).toBe("unknown field 'visibilty'");
  });

  test('isLaurelError narrows correctly', () => {
    const err = new LaurelError({ message: 'x' });
    expect(isLaurelError(err)).toBe(true);
    expect(isLaurelError(new Error('plain'))).toBe(false);
    expect(isLaurelError('string')).toBe(false);
  });
});

describe('formatLaurelError', () => {
  test('renders Cargo-style pointer with file:line:col and hint', () => {
    const err = new LaurelError({
      message: "unknown field 'visibilty'",
      file: '/repo/content/posts/foo.md',
      line: 3,
      col: 5,
      hint: "did you mean 'visibility'?",
    });
    const out = formatLaurelError(err, { cwd: '/repo' });
    expect(out).toContain('---- content/posts/foo.md:3:5 - ');
    expect(out).toContain("unknown field 'visibilty'");
    expect(out).toContain("hint: did you mean 'visibility'?");
  });

  test('omits col when only line is known', () => {
    const err = new LaurelError({
      message: 'invalid frontmatter: bad indentation',
      file: '/repo/x.md',
      line: 7,
    });
    const out = formatLaurelError(err, { cwd: '/repo' });
    expect(out).toBe('---- x.md:7 - invalid frontmatter: bad indentation');
  });

  test('falls back to message-only when no file is known', () => {
    const err = new LaurelError({ message: 'something bad' });
    expect(formatLaurelError(err)).toBe('---- something bad');
  });

  test('keeps absolute path when cwd is unrelated', () => {
    const err = new LaurelError({ message: 'oops', file: '/elsewhere/x.md', line: 1 });
    const out = formatLaurelError(err, { cwd: '/repo' });
    expect(out).toContain('/elsewhere/x.md:1');
  });
});

describe('toLaurelError', () => {
  test('wraps a plain error with file context', () => {
    const wrapped = toLaurelError(new Error('boom'), { file: '/repo/x.md' });
    expect(wrapped).toBeInstanceOf(LaurelError);
    expect(wrapped.file).toBe('/repo/x.md');
    expect(wrapped.message).toBe('boom');
  });

  test('preserves an existing LaurelError unchanged when file already matches', () => {
    const original = new LaurelError({ message: 'x', file: '/repo/a.md', line: 2 });
    const wrapped = toLaurelError(original, { file: '/repo/a.md' });
    expect(wrapped).toBe(original);
  });

  test('augments LaurelError with file when missing', () => {
    const original = new LaurelError({ message: 'x' });
    const wrapped = toLaurelError(original, { file: '/repo/a.md' });
    expect(wrapped).not.toBe(original);
    expect(wrapped.file).toBe('/repo/a.md');
    expect(wrapped.message).toBe('x');
  });
});

describe('exitCodeForError', () => {
  test('maps each LaurelErrorCode to its reserved exit code', () => {
    expect(exitCodeForError(new LaurelError({ message: 'c', code: 'config' }))).toBe(
      EXIT_CODES.config,
    );
    expect(exitCodeForError(new LaurelError({ message: 'c', code: 'content' }))).toBe(
      EXIT_CODES.content,
    );
    expect(exitCodeForError(new LaurelError({ message: 'c', code: 'theme' }))).toBe(
      EXIT_CODES.theme,
    );
    expect(exitCodeForError(new LaurelError({ message: 'c', code: 'render' }))).toBe(
      EXIT_CODES.render,
    );
    expect(exitCodeForError(new LaurelError({ message: 'c', code: 'emit' }))).toBe(EXIT_CODES.emit);
  });

  test('untagged LaurelError falls back to generic (1)', () => {
    expect(exitCodeForError(new LaurelError({ message: 'no code' }))).toBe(EXIT_CODES.generic);
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

describe('toLaurelError preserves code', () => {
  test('keeps code when augmenting with file', () => {
    const original = new LaurelError({ message: 'x', code: 'content' });
    const wrapped = toLaurelError(original, { file: '/repo/a.md' });
    expect(wrapped).not.toBe(original);
    expect(wrapped.code).toBe('content');
    expect(wrapped.file).toBe('/repo/a.md');
  });

  test('plain Error wrapped without a code stays untagged', () => {
    const wrapped = toLaurelError(new Error('boom'), { file: '/repo/x.md' });
    expect(wrapped.code).toBeUndefined();
  });
});

describe('LaurelError docsUrl', () => {
  test('stores and exposes docsUrl', () => {
    const err = new LaurelError({
      message: 'theme/missing',
      docsUrl: 'https://laurel.dev/docs/theme',
    });
    expect(err.docsUrl).toBe('https://laurel.dev/docs/theme');
  });

  test('formatLaurelError prints a docs: line when set', () => {
    const err = new LaurelError({
      message: 'oops',
      file: '/repo/x.md',
      line: 1,
      hint: 'fix it',
      docsUrl: 'https://laurel.dev/docs/x',
    });
    const out = formatLaurelError(err, { cwd: '/repo' });
    expect(out).toContain('hint: fix it');
    expect(out).toContain('docs: https://laurel.dev/docs/x');
  });

  test('formatLaurelError omits docs: line when unset', () => {
    const err = new LaurelError({ message: 'oops', file: '/repo/x.md', line: 1, hint: 'fix it' });
    const out = formatLaurelError(err, { cwd: '/repo' });
    expect(out).not.toContain('docs:');
  });

  test('toLaurelError preserves docsUrl', () => {
    const original = new LaurelError({ message: 'x', docsUrl: 'https://a.b/c' });
    const wrapped = toLaurelError(original, { file: '/repo/y.md' });
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
