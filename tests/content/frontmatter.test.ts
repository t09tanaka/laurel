import { describe, expect, test } from 'bun:test';
import { asDateISO, parseFrontmatter } from '~/content/frontmatter.ts';
import { NectarError } from '~/util/errors.ts';

describe('asDateISO', () => {
  test('parses ISO date strings', () => {
    const out = asDateISO('2026-01-02T03:04:05Z');
    expect(out).toBe('2026-01-02T03:04:05.000Z');
  });

  test('returns Date instances as ISO', () => {
    const out = asDateISO(new Date('2026-05-19T00:00:00Z'));
    expect(out).toBe('2026-05-19T00:00:00.000Z');
  });

  test('uses fallback silently when value is undefined', () => {
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO(undefined, fallback)).toBe(fallback);
  });

  test('uses fallback silently when value is null', () => {
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO(null, fallback)).toBe(fallback);
  });

  test('uses fallback silently when value is an empty string', () => {
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(asDateISO('   ', fallback)).toBe(fallback);
  });

  test('throws NectarError including post path and original value for an unparseable date string', () => {
    const postPath = 'content/posts/foo.md';
    expect(() => asDateISO('not-a-date', undefined, `${postPath} date`)).toThrow(NectarError);
    try {
      asDateISO('not-a-date', undefined, `${postPath} date`);
      throw new Error('expected asDateISO to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.code).toBe('content');
      expect(ne.message).toContain(postPath);
      expect(ne.message).toContain('not-a-date');
      expect(ne.message).toMatch(/Invalid date in frontmatter/);
    }
  });

  test('throws NectarError including post path when fallback is provided but value is unparseable', () => {
    const postPath = 'content/posts/bar.md';
    const fallback = '2026-01-01T00:00:00.000Z';
    expect(() => asDateISO('totally bogus', fallback, `${postPath} published_at`)).toThrow(
      NectarError,
    );
    try {
      asDateISO('totally bogus', fallback, `${postPath} published_at`);
    } catch (err) {
      const ne = err as NectarError;
      expect(ne.message).toContain(postPath);
      expect(ne.message).toContain('totally bogus');
    }
  });

  test('throws NectarError for an unexpected non-string type, embedding context', () => {
    const postPath = 'content/posts/baz.md';
    try {
      asDateISO({ year: 2026 } as unknown, undefined, `${postPath} date`);
      throw new Error('expected asDateISO to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.message).toContain(postPath);
      expect(ne.message).toMatch(/unexpected object value/);
    }
  });

  test('throws NectarError for an Invalid Date instance', () => {
    const postPath = 'content/posts/qux.md';
    try {
      asDateISO(new Date('not-a-date'), undefined, `${postPath} date`);
      throw new Error('expected asDateISO to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NectarError);
      const ne = err as NectarError;
      expect(ne.message).toContain(postPath);
      expect(ne.message).toMatch(/Invalid Date/);
    }
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
