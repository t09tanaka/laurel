import { describe, expect, test } from 'bun:test';
import { isValidCliSlug, slugifyCliValue } from '~/cli/slug.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { renderMarkdown } from '~/content/markdown.ts';

function nextRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function sample(rand: () => number, alphabet: string, maxLen: number): string {
  const len = Math.floor(rand() * maxLen);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(rand() * alphabet.length)] ?? '';
  }
  return out;
}

describe('deterministic content property tests', () => {
  test('frontmatter parser round-trips generated scalar title values', () => {
    const rand = nextRand(0x1252);
    for (let i = 0; i < 250; i += 1) {
      const title = sample(rand, 'abcdefghijklmnopqrstuvwxyz 0123456789-_', 48).trim() || 'x';
      const raw = `---\ntitle: ${JSON.stringify(title)}\nfeatured: true\n---\n\nBody ${i}\n`;
      const parsed = parseFrontmatter(raw, { filePath: `/tmp/post-${i}.md` });
      expect(parsed.data.title).toBe(title);
      expect(parsed.data.featured).toBe('true');
      expect(parsed.body).toContain(`Body ${i}`);
    }
  });

  test('markdown renderer keeps random unicode finite and script-free', async () => {
    const rand = nextRand(0x1286);
    const alphabet = 'abc 日本語 한글 🙂 <>[]()_*`\\\n';
    for (let i = 0; i < 120; i += 1) {
      const body = sample(rand, alphabet, 240);
      const rendered = await renderMarkdown(body);
      expect(rendered.html).not.toContain('<script');
      expect(rendered.reading_time).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(rendered.word_count)).toBe(true);
    }
  });

  test('slug derivation never returns a value outside the accepted slug grammar', () => {
    const rand = nextRand(0x1287);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 0123456789---___!!?';
    for (let i = 0; i < 500; i += 1) {
      const title = sample(rand, alphabet, 80);
      const slug = slugifyCliValue(title);
      if (slug.length === 0) continue;
      expect(isValidCliSlug(slug)).toBe(true);
    }
  });
});
