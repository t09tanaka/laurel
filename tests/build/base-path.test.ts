import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { normalizeBasePath } from '~/build/base-path.ts';
import { resetWarningCount } from '~/util/logger.ts';

const originalStderrWrite = process.stderr.write.bind(process.stderr);

interface CapturedStderr {
  output: string;
  restore: () => void;
}

function captureStderr(): CapturedStderr {
  let output = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    get output() {
      return output;
    },
    restore: () => {
      process.stderr.write = originalStderrWrite;
    },
  };
}

describe('normalizeBasePath', () => {
  beforeEach(() => {
    resetWarningCount();
  });
  afterEach(() => {
    resetWarningCount();
  });

  test('returns "/" unchanged', () => {
    expect(normalizeBasePath('/')).toBe('/');
  });

  test('adds trailing slash when missing', () => {
    expect(normalizeBasePath('/blog')).toBe('/blog/');
  });

  test('keeps trailing slash when present', () => {
    expect(normalizeBasePath('/blog/')).toBe('/blog/');
  });

  test('handles nested paths', () => {
    expect(normalizeBasePath('/a/b/c')).toBe('/a/b/c/');
  });

  test('collapses duplicate slashes', () => {
    expect(normalizeBasePath('/blog//preview')).toBe('/blog/preview/');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeBasePath('  /blog/  ')).toBe('/blog/');
  });

  test('warns and prepends slash when input does not start with "/"', () => {
    const cap = captureStderr();
    try {
      const result = normalizeBasePath('blog');
      expect(result).toBe('/blog/');
      expect(cap.output).toContain('does not start with "/"');
      expect(cap.output).toContain('[warn]');
    } finally {
      cap.restore();
    }
  });

  test('warns and normalises when input is missing leading slash but has trailing slash', () => {
    const cap = captureStderr();
    try {
      expect(normalizeBasePath('blog/')).toBe('/blog/');
      expect(cap.output).toContain('does not start with "/"');
    } finally {
      cap.restore();
    }
  });

  test('throws on empty string', () => {
    expect(() => normalizeBasePath('')).toThrow(/must not be empty/);
  });

  test('throws on whitespace-only string', () => {
    expect(() => normalizeBasePath('   ')).toThrow(/must not be empty/);
  });

  test('throws when given a non-string value', () => {
    expect(() => normalizeBasePath(123 as unknown as string)).toThrow(/must be a string/);
  });
});
