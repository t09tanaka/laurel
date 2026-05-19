import { describe, expect, test } from 'bun:test';
import { asDateISO, parseFrontmatter } from '~/content/frontmatter.ts';
import { NectarError } from '~/util/errors.ts';
import { getWarningCount, resetWarningCount } from '~/util/logger.ts';

describe('asDateISO', () => {
  test('parses ISO date strings', () => {
    resetWarningCount();
    const out = asDateISO('2026-01-02T03:04:05Z');
    expect(out).toBe('2026-01-02T03:04:05.000Z');
    expect(getWarningCount()).toBe(0);
  });

  test('returns Date instances as ISO', () => {
    resetWarningCount();
    const out = asDateISO(new Date('2026-05-19T00:00:00Z'));
    expect(out).toBe('2026-05-19T00:00:00.000Z');
    expect(getWarningCount()).toBe(0);
  });

  test('uses fallback silently when value is undefined', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO(undefined, fallback)).toBe(fallback);
    expect(getWarningCount()).toBe(0);
  });

  test('uses fallback silently when value is an empty string', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO('   ', fallback)).toBe(fallback);
    expect(getWarningCount()).toBe(0);
  });

  test('warns when value is a non-empty invalid date string', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    const out = asDateISO('not-a-date', fallback, 'posts/foo.md date');
    expect(out).toBe(fallback);
    expect(getWarningCount()).toBe(1);
  });

  test('warns when value is an unexpected non-string type', () => {
    resetWarningCount();
    const fallback = '2026-01-01T00:00:00.000Z';
    const out = asDateISO({ year: 2026 } as unknown, fallback);
    expect(out).toBe(fallback);
    expect(getWarningCount()).toBe(1);
  });
});

describe('parseFrontmatter error reporting', () => {
  test('throws NectarError with file:line:col when YAML is malformed', () => {
    const raw = `---
title: ok
  date: 2026-01-01
---

body
`;
    try {
      parseFrontmatter(raw, { filePath: '/repo/content/posts/foo.md' });
      throw new Error('expected parseFrontmatter to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.file).toBe('/repo/content/posts/foo.md');
      expect(ne.line).toBe(3);
      expect(ne.message).toMatch(/invalid frontmatter/);
      expect(ne.message).toMatch(/bad indentation/);
    }
  });

  test('still throws NectarError without file when filePath omitted', () => {
    const raw = `---
title: ok
  date: 2026-01-01
---

body
`;
    expect(() => parseFrontmatter(raw)).toThrow(NectarError);
  });

  test('returns parsed data for valid frontmatter', () => {
    const { data, body } = parseFrontmatter('---\ntitle: Hello\n---\n\nWorld\n', {
      filePath: '/x.md',
    });
    expect(data.title).toBe('Hello');
    expect(body.trim()).toBe('World');
  });
});
