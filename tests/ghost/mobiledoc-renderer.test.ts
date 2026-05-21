import { describe, expect, test } from 'bun:test';
import { renderMobiledocToHtml } from '~/ghost/mobiledoc-renderer.ts';

function mobi(doc: Record<string, unknown>): string {
  return JSON.stringify({ version: '0.3.1', atoms: [], cards: [], markups: [], ...doc });
}

describe('renderMobiledocToHtml', () => {
  test('returns empty string for empty / invalid input', () => {
    expect(renderMobiledocToHtml('')).toBe('');
    expect(renderMobiledocToHtml(null)).toBe('');
    expect(renderMobiledocToHtml(undefined)).toBe('');
    expect(renderMobiledocToHtml('not json')).toBe('');
  });

  test('renders a plain paragraph markup section', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[1, 'p', [[0, [], 0, 'Hello']]]],
      }),
    );
    expect(out).toBe('<p>Hello</p>');
  });

  test('renders headings via markup-section tags', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [
          [1, 'h1', [[0, [], 0, 'Big']]],
          [1, 'h3', [[0, [], 0, 'Small']]],
        ],
      }),
    );
    expect(out).toBe('<h1>Big</h1><h3>Small</h3>');
  });

  test('renders bold and italic via markups', () => {
    const out = renderMobiledocToHtml(
      mobi({
        markups: [['strong'], ['em']],
        sections: [
          [
            1,
            'p',
            [
              [0, [0], 1, 'bold'],
              [0, [], 0, ' rest'],
            ],
          ],
        ],
      }),
    );
    expect(out).toBe('<p><strong>bold</strong> rest</p>');
  });

  test('renders links with href attribute', () => {
    const out = renderMobiledocToHtml(
      mobi({
        markups: [['a', ['href', 'https://example.com']]],
        sections: [[1, 'p', [[0, [0], 1, 'click']]]],
      }),
    );
    expect(out).toBe('<p><a href="https://example.com">click</a></p>');
  });

  test('escapes HTML special characters', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[1, 'p', [[0, [], 0, '<x>&y']]]],
      }),
    );
    expect(out).toBe('<p>&lt;x&gt;&amp;y</p>');
  });

  test('renders list sections', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[3, 'ul', [[[0, [], 0, 'a']], [[0, [], 0, 'b']]]]],
      }),
    );
    expect(out).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  test('renders ordered lists', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[3, 'ol', [[[0, [], 0, 'first']]]]],
      }),
    );
    expect(out).toBe('<ol><li>first</li></ol>');
  });

  test('renders deprecated image sections', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[2, '/content/images/2020/old.jpg']],
      }),
    );
    expect(out).toBe(
      '<figure class="kg-card kg-image-card"><img src="/content/images/2020/old.jpg" alt=""></figure>',
    );
  });

  test('renders a card section from the cards array', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [['hr', {}]],
        sections: [[10, 0]],
      }),
    );
    expect(out).toBe('<hr>');
  });

  test('renders the image card from a card section', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [['image', { src: '/x.jpg', alt: 'A', caption: 'cap' }]],
        sections: [[10, 0]],
      }),
    );
    expect(out).toContain('kg-image-card');
    expect(out).toContain('kg-card-hascaption');
    expect(out).toContain('src="/x.jpg"');
    expect(out).toContain('alt="A"');
    expect(out).toContain('aria-labelledby="kg-card-caption-');
    expect(out).toContain('<figcaption id="kg-card-caption-');
    expect(out).toContain('>cap</figcaption>');
  });

  test('preserves Koenig cardWidth on card sections', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [
          ['image', { src: '/x.jpg', cardWidth: 'wide' }],
          ['gallery', { cardWidth: 'full', images: [{ src: '/g.jpg', alt: 'G' }] }],
          ['embed', { url: 'https://example.com/embed', cardWidth: 'regular' }],
          ['video', { src: '/clip.mp4', cardWidth: 'wide' }],
        ],
        sections: [
          [10, 0],
          [10, 1],
          [10, 2],
          [10, 3],
        ],
      }),
    );
    expect(out).toContain('class="kg-card kg-image-card kg-width-wide"');
    expect(out).toContain('class="kg-card kg-gallery-card kg-width-full"');
    expect(out).toContain('class="kg-card kg-embed-card kg-width-regular"');
    expect(out).toContain('class="kg-card kg-video-card kg-width-wide"');
  });

  test('lazy-loads iframe embed card html', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [
          [
            'embed',
            {
              html: '<iframe src="https://www.youtube.com/embed/abc123" title="Talk"></iframe>',
            },
          ],
        ],
        sections: [[10, 0]],
      }),
    );
    expect(out).toContain('class="kg-card kg-embed-card"');
    expect(out).toContain(
      '<iframe src="https://www.youtube.com/embed/abc123" title="Talk" loading="lazy"></iframe>',
    );
  });

  test('renders a code card from a card section', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [['code', { code: 'x = 1', language: 'python' }]],
        sections: [[10, 0]],
      }),
    );
    expect(out).toBe(
      '<figure class="kg-card kg-code-card"><button class="kg-code-card-copy" type="button">Copy</button><pre><code class="language-python">x = 1</code></pre></figure>',
    );
  });

  test('marks callout cards without an emoji as iconless', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [['callout', { backgroundColor: 'grey', calloutText: 'No icon.' }]],
        sections: [[10, 0]],
      }),
    );
    expect(out).toContain(
      'class="kg-card kg-callout-card kg-callout-card-grey kg-callout-card-without-emoji"',
    );
    expect(out).not.toContain('kg-callout-emoji');
    expect(out).toContain('<div class="kg-callout-text">No icon.</div>');
  });

  test('keeps explicit callout emoji content', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [
          ['callout', { backgroundColor: 'pink', calloutEmoji: '✨', calloutText: 'Custom icon.' }],
        ],
        sections: [[10, 0]],
      }),
    );
    expect(out).toContain('class="kg-card kg-callout-card kg-callout-card-pink"');
    expect(out).toContain('<div class="kg-callout-emoji">✨</div>');
    expect(out).not.toContain('kg-callout-card-without-emoji');
  });

  test('renders a blockquote markup section', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[1, 'blockquote', [[0, [], 0, 'quote']]]],
      }),
    );
    expect(out).toBe('<blockquote>quote</blockquote>');
  });

  test('renders legacy pull-quote sections as Ghost alternate blockquotes', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[1, 'pull-quote', [[0, [], 0, 'quote']]]],
      }),
    );
    expect(out).toBe('<blockquote class="kg-blockquote-alt">quote</blockquote>');
  });

  test('renders an html card via the kg-card fence', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [['html', { html: '<div>x</div>' }]],
        sections: [[10, 0]],
      }),
    );
    expect(out).toBe('<!--kg-card-begin: html--><div>x</div><!--kg-card-end: html-->');
  });

  test('falls back to <p> for unrecognised markup tag', () => {
    const out = renderMobiledocToHtml(
      mobi({
        sections: [[1, 'weird', [[0, [], 0, 'x']]]],
      }),
    );
    expect(out).toBe('<p>x</p>');
  });

  test('renders soft-return atom as <br>', () => {
    const out = renderMobiledocToHtml(
      mobi({
        atoms: [['soft-return', '', {}]],
        sections: [
          [
            1,
            'p',
            [
              [0, [], 0, 'a'],
              [1, [], 0, 0],
              [0, [], 0, 'b'],
            ],
          ],
        ],
      }),
    );
    expect(out).toBe('<p>a<br>b</p>');
  });

  test('preserves paywall card boundary, renders signup, and drops email-only cards', () => {
    const out = renderMobiledocToHtml(
      mobi({
        cards: [
          ['paywall', {}],
          ['email', { html: '<p>x</p>' }],
          ['email-cta', {}],
          ['signup', { heading: 'Join', buttonText: 'Subscribe' }],
        ],
        sections: [
          [10, 0],
          [10, 1],
          [10, 2],
          [10, 3],
          [1, 'p', [[0, [], 0, 'public']]],
        ],
      }),
    );
    expect(out).toContain('<!--members-only-->');
    expect(out).toContain('class="kg-card kg-signup-card"');
    expect(out).toContain('data-members-form="signup"');
    expect(out).toContain('<p>public</p>');
    expect(out).not.toContain('<p>x</p>');
  });
});
