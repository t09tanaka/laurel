import { describe, expect, test } from 'bun:test';
import {
  rewriteComponentSlugInBody,
  splitFrontmatterRaw,
} from '../../src/content/component-references.ts';

describe('rewriteComponentSlugInBody — basic contexts', () => {
  test('rewrites in a plain paragraph', () => {
    const out = rewriteComponentSlugInBody('See {callout} below.', 'callout', 'hero');
    expect(out.body).toBe('See {hero} below.');
    expect(out.count).toBe(1);
  });

  test('rewrites multiple occurrences on the same line', () => {
    const out = rewriteComponentSlugInBody(
      '{callout} and again {callout} on one line',
      'callout',
      'hero',
    );
    expect(out.body).toBe('{hero} and again {hero} on one line');
    expect(out.count).toBe(2);
  });

  test('rewrites in a list item', () => {
    const out = rewriteComponentSlugInBody('- {callout}\n- other', 'callout', 'hero');
    expect(out.body).toBe('- {hero}\n- other');
    expect(out.count).toBe(1);
  });

  test('rewrites in a blockquote', () => {
    const out = rewriteComponentSlugInBody('> see {callout}', 'callout', 'hero');
    expect(out.body).toBe('> see {hero}');
    expect(out.count).toBe(1);
  });

  test('rewrites in a GFM table cell', () => {
    const out = rewriteComponentSlugInBody('| Col |\n| --- |\n| {callout} |\n', 'callout', 'hero');
    expect(out.body).toBe('| Col |\n| --- |\n| {hero} |\n');
    expect(out.count).toBe(1);
  });
});

describe('rewriteComponentSlugInBody — code regions are skipped', () => {
  test('skips fenced code (backticks)', () => {
    const body = '```html\n{callout}\n```';
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    expect(out.body).toBe(body);
    expect(out.count).toBe(0);
  });

  test('skips fenced code (tildes)', () => {
    const body = '~~~html\n{callout}\n~~~';
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    expect(out.body).toBe(body);
    expect(out.count).toBe(0);
  });

  test('skips fenced code with language tag', () => {
    const body = '```javascript\nconst x = `{callout}`;\n```';
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    expect(out.body).toBe(body);
    expect(out.count).toBe(0);
  });

  test('skips inline code spans', () => {
    const out = rewriteComponentSlugInBody(
      'use `{callout}` to embed, or write {callout} alone',
      'callout',
      'hero',
    );
    expect(out.body).toBe('use `{callout}` to embed, or write {hero} alone');
    expect(out.count).toBe(1);
  });

  test('skips multi-backtick inline code', () => {
    const out = rewriteComponentSlugInBody('``a `{callout}` b`` and {callout}', 'callout', 'hero');
    expect(out.body).toBe('``a `{callout}` b`` and {hero}');
    expect(out.count).toBe(1);
  });

  test('rewrites before and after a fenced block but not inside', () => {
    const body = ['before {callout}', '```', '{callout} skipped', '```', 'after {callout}'].join(
      '\n',
    );
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    expect(out.body).toBe(
      ['before {hero}', '```', '{callout} skipped', '```', 'after {hero}'].join('\n'),
    );
    expect(out.count).toBe(2);
  });
});

describe('rewriteComponentSlugInBody — false matches', () => {
  test('does not rewrite a similarly-named slug', () => {
    const out = rewriteComponentSlugInBody('{callout-v2} {calloutx}', 'callout', 'hero');
    expect(out.body).toBe('{callout-v2} {calloutx}');
    expect(out.count).toBe(0);
  });

  test('does not rewrite a brace pattern without exact slug match', () => {
    const out = rewriteComponentSlugInBody('CSS: p { color: red }', 'callout', 'hero');
    expect(out.body).toBe('CSS: p { color: red }');
    expect(out.count).toBe(0);
  });

  test('fast path: no occurrence returns body unchanged', () => {
    const body = 'no shortcodes here';
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    // Identity, not a copy — small perf cosmetic.
    expect(out.body).toBe(body);
    expect(out.count).toBe(0);
  });

  test('returns body unchanged when old === new', () => {
    const out = rewriteComponentSlugInBody('{callout}', 'callout', 'callout');
    expect(out.body).toBe('{callout}');
    expect(out.count).toBe(0);
  });
});

describe('splitFrontmatterRaw', () => {
  test('separates YAML frontmatter from body byte-for-byte', () => {
    const raw = '---\ntitle: Hello\n---\nbody text\n';
    const out = splitFrontmatterRaw(raw);
    expect(out.frontmatter).toBe('---\ntitle: Hello\n---\n');
    expect(out.body).toBe('body text\n');
  });

  test('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Hi\r\n---\r\nbody\r\n';
    const out = splitFrontmatterRaw(raw);
    expect(out.frontmatter).toBe('---\r\ntitle: Hi\r\n---\r\n');
    expect(out.body).toBe('body\r\n');
  });

  test('returns empty frontmatter when none present', () => {
    const raw = '# just body\n';
    const out = splitFrontmatterRaw(raw);
    expect(out.frontmatter).toBe('');
    expect(out.body).toBe(raw);
  });

  test('does not match a `---` that is not at the start of a line', () => {
    // A `---` mid-paragraph should not be treated as a closing fence.
    const raw = '---\ntitle: foo\nweird --- inline\n---\nbody';
    const out = splitFrontmatterRaw(raw);
    expect(out.frontmatter).toBe('---\ntitle: foo\nweird --- inline\n---\n');
    expect(out.body).toBe('body');
  });

  test('returns empty frontmatter for malformed opener', () => {
    const raw = '---text-after-the-fence\nbody';
    const out = splitFrontmatterRaw(raw);
    expect(out.frontmatter).toBe('');
    expect(out.body).toBe(raw);
  });
});

describe('rewriteComponentSlugInBody — integration with frontmatter', () => {
  test('rewriter leaves frontmatter untouched when caller splits it', () => {
    // Sanity check the pattern callers will use: split, rewrite body,
    // concat. The frontmatter should round-trip byte-for-byte even if
    // it happened to contain a `{callout}` token (unusual but valid YAML).
    const raw = '---\ntitle: "Using {callout}"\n---\nThe {callout} block.';
    const { frontmatter, body } = splitFrontmatterRaw(raw);
    const out = rewriteComponentSlugInBody(body, 'callout', 'hero');
    const rejoined = frontmatter + out.body;
    expect(rejoined).toBe('---\ntitle: "Using {callout}"\n---\nThe {hero} block.');
    expect(out.count).toBe(1);
  });
});
