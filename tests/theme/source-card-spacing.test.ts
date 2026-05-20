import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMarkdown } from '~/content/markdown.ts';

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

describe('Source theme — heading/card spacing contract (#932)', () => {
  test('Markdown headings still receive anchor IDs', async () => {
    const { html } = await renderMarkdown(
      '## Section title\n\n{{< bookmark url="https://example.com" title="Example" />}}',
    );

    expect(html).toContain('<h2 id="section-title">Section title</h2>');
    expect(html).toContain('class="kg-card kg-bookmark-card');
  });

  test('source CSS uses headings, not id attributes, for card spacing exceptions', async () => {
    const css = await read('assets/css/screen.css');

    expect(css).toContain(
      'Ghost Source historically used [id] as a heading proxy here. Nectar assigns heading IDs',
    );
    expect(css).toContain(
      '.gh-content :not(.kg-card):not(table):not(:is(h1, h2, h3, h4, h5, h6)) + :is(.kg-card, table)',
    );
    expect(css).toContain(
      '.gh-content :is(.kg-card, table) + :not(.kg-card):not(table):not(:is(h1, h2, h3, h4, h5, h6))',
    );
    expect(css).toContain(
      '.gh-content :not(.kg-card):not(:is(h1, h2, h3, h4, h5, h6)) + .kg-card.kg-width-full',
    );
    expect(css).toContain(
      '.gh-content .kg-card.kg-width-full + :not(.kg-card):not(:is(h1, h2, h3, h4, h5, h6))',
    );
    expect(css).not.toContain(':not(.kg-card):not(table):not([id]) + :is(.kg-card, table)');
    expect(css).not.toContain(':is(.kg-card, table) + :not(.kg-card):not(table):not([id])');
  });

  test('built CSS carries the heading-based card spacing selectors', async () => {
    const css = await read('assets/built/screen.css');

    expect(css).toContain(
      '.gh-content :not(.kg-card):not(table):not(:is(h1,h2,h3,h4,h5,h6))+:is(.kg-card,table)',
    );
    expect(css).toContain(
      '.gh-content :is(.kg-card,table)+:not(.kg-card):not(table):not(:is(h1,h2,h3,h4,h5,h6))',
    );
    expect(css).toContain(
      '.gh-content :not(.kg-card):not(:is(h1,h2,h3,h4,h5,h6))+.kg-card.kg-width-full',
    );
    expect(css).toContain(
      '.gh-content .kg-card.kg-width-full+:not(.kg-card):not(:is(h1,h2,h3,h4,h5,h6))',
    );
    expect(css).not.toContain(':not(.kg-card):not(table):not([id])+:is(.kg-card,table)');
    expect(css).not.toContain(':is(.kg-card,table)+:not(.kg-card):not(table):not([id])');
  });
});
