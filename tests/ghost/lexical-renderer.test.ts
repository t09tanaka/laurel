import { describe, expect, test } from 'bun:test';
import { renderLexicalToHtml } from '~/ghost/lexical-renderer.ts';

function lex(children: unknown[]): string {
  return JSON.stringify({ root: { type: 'root', children, version: 1 } });
}

function text(value: string, format = 0): Record<string, unknown> {
  return { type: 'extended-text', text: value, format, version: 1 };
}

describe('renderLexicalToHtml', () => {
  test('renders an empty input as empty string', () => {
    expect(renderLexicalToHtml('')).toBe('');
    expect(renderLexicalToHtml(null)).toBe('');
    expect(renderLexicalToHtml(undefined)).toBe('');
  });

  test('returns empty string for invalid JSON', () => {
    expect(renderLexicalToHtml('not json')).toBe('');
  });

  test('renders a paragraph with plain text', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('Hello world')], version: 1 }]),
    );
    expect(out).toBe('<p>Hello world</p>');
  });

  test('renders headings with the given tag', () => {
    const out = renderLexicalToHtml(
      lex([
        { type: 'heading', tag: 'h1', children: [text('Title')], version: 1 },
        { type: 'heading', tag: 'h3', children: [text('Sub')], version: 1 },
      ]),
    );
    expect(out).toBe('<h1>Title</h1><h3>Sub</h3>');
  });

  test('defaults invalid heading tag to h2', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'heading', tag: 'h99', children: [text('X')], version: 1 }]),
    );
    expect(out).toBe('<h2>X</h2>');
  });

  test('renders bullet and numbered lists', () => {
    const ul = renderLexicalToHtml(
      lex([
        {
          type: 'list',
          listType: 'bullet',
          children: [
            { type: 'listitem', children: [text('a')], version: 1 },
            { type: 'listitem', children: [text('b')], version: 1 },
          ],
          version: 1,
        },
      ]),
    );
    expect(ul).toBe('<ul><li>a</li><li>b</li></ul>');

    const ol = renderLexicalToHtml(
      lex([
        {
          type: 'list',
          listType: 'number',
          children: [{ type: 'listitem', children: [text('one')], version: 1 }],
          version: 1,
        },
      ]),
    );
    expect(ol).toBe('<ol><li>one</li></ol>');
  });

  test('applies inline formatting from the format bitfield', () => {
    const bold = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('B', 1)], version: 1 }]),
    );
    expect(bold).toBe('<p><strong>B</strong></p>');

    const italic = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('I', 2)], version: 1 }]),
    );
    expect(italic).toBe('<p><em>I</em></p>');

    const boldItalic = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('BI', 1 | 2)], version: 1 }]),
    );
    expect(boldItalic).toBe('<p><strong><em>BI</em></strong></p>');

    const code = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('c', 16)], version: 1 }]),
    );
    expect(code).toBe('<p><code>c</code></p>');
  });

  test('renders links with href', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com',
              children: [text('click')],
              version: 1,
            },
          ],
          version: 1,
        },
      ]),
    );
    expect(out).toBe('<p><a href="https://example.com">click</a></p>');
  });

  test('escapes HTML-special characters in text', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'paragraph', children: [text('<script>&amp;</script>')], version: 1 }]),
    );
    expect(out).toBe('<p>&lt;script&gt;&amp;amp;&lt;/script&gt;</p>');
  });

  test('renders horizontalrule and linebreak nodes', () => {
    const out = renderLexicalToHtml(
      lex([
        { type: 'horizontalrule', version: 1 },
        {
          type: 'paragraph',
          children: [text('a'), { type: 'linebreak', version: 1 }, text('b')],
          version: 1,
        },
      ]),
    );
    expect(out).toBe('<hr><p>a<br>b</p>');
  });

  test('renders blockquote nodes', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'quote',
          children: [text('To be')],
          version: 1,
        },
      ]),
    );
    expect(out).toBe('<blockquote>To be</blockquote>');
  });

  test('renders alternate blockquote nodes with Ghost class', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'quote',
          variant: 'alt',
          children: [text('Pull quote')],
          version: 1,
        },
      ]),
    );
    expect(out).toBe('<blockquote class="kg-blockquote-alt">Pull quote</blockquote>');
  });

  test('renders an image card with caption and href', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'image',
          src: '/content/images/2024/01/x.jpg',
          alt: 'A picture',
          caption: 'My caption',
          href: 'https://example.com',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('kg-image-card');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('src="/content/images/2024/01/x.jpg"');
    expect(out).toContain('alt="A picture"');
    expect(out).toContain('kg-card-hascaption');
    expect(out).toContain('>My caption</figcaption>');
  });

  test('associates figure captions with their Koenig figures', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'image',
          src: '/content/images/2024/01/x.jpg',
          caption: 'Accessible caption',
          version: 1,
        },
      ]),
    );

    expect(out).toContain('role="group"');
    expect(out).toContain('aria-labelledby="kg-card-caption-');
    expect(out).toContain('<figcaption id="kg-card-caption-');
    expect(out).toContain('Accessible caption</figcaption>');
  });

  test('preserves Koenig cardWidth on figure-based cards', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'image',
          src: '/content/images/2024/01/x.jpg',
          cardWidth: 'full',
          version: 1,
        },
        {
          type: 'gallery',
          cardWidth: 'wide',
          images: [{ src: '/content/images/a.jpg', alt: 'A' }],
          version: 1,
        },
        {
          type: 'embed',
          url: 'https://example.com/embed',
          cardWidth: 'regular',
          caption: 'Embed caption',
          version: 1,
        },
        {
          type: 'video',
          src: '/content/media/clip.mp4',
          cardWidth: 'wide',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('class="kg-card kg-image-card kg-width-full"');
    expect(out).toContain('class="kg-card kg-gallery-card kg-width-wide"');
    expect(out).toContain('class="kg-card kg-embed-card kg-width-regular kg-card-hascaption"');
    expect(out).toContain('class="kg-card kg-video-card kg-width-wide"');
  });

  test('renders product cards in the Source theme DOM contract order', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'product',
          productTitle: 'Sample widget',
          productDescription: '<p>A short product description.</p>',
          productImageSrc: 'https://cdn.test/product.jpg',
          productRating: 5,
          productUrl: 'https://example.com/buy',
          productButton: 'Buy now',
          cardWidth: 'regular',
          version: 1,
        },
      ]),
    );
    expect(out).toBe(
      '<div class="kg-card kg-product-card kg-width-regular"><div class="kg-product-card-container"><img class="kg-product-card-image" src="https://cdn.test/product.jpg" alt=""><div class="kg-product-card-title">Sample widget</div><div class="kg-product-card-rating" data-rating="5"></div><div class="kg-product-card-description"><p>A short product description.</p></div><a class="kg-product-card-button kg-product-card-btn-accent" href="https://example.com/buy">Buy now</a></div></div>',
    );
  });

  test('preserves product card image srcset and sizes', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'product',
          productTitle: 'Sample widget',
          productImageSrc: 'https://cdn.test/product.jpg',
          productImageSrcset:
            'https://cdn.test/product-720.jpg 720w, https://cdn.test/product.jpg 1440w',
          productImageSizes: '(min-width: 720px) 720px, 100vw',
          version: 1,
        },
      ]),
    );

    expect(out).toContain(
      'srcset="https://cdn.test/product-720.jpg 720w, https://cdn.test/product.jpg 1440w"',
    );
    expect(out).toContain('sizes="(min-width: 720px) 720px, 100vw"');
  });

  test('renders code cards with Ghost-compatible wrapper and copy control', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'code', code: 'console.log("x")', language: 'js', version: 1 }]),
    );

    expect(out).toBe(
      '<figure class="kg-card kg-code-card"><button class="kg-code-card-copy" type="button">Copy</button><pre><code class="language-js">console.log("x")</code></pre></figure>',
    );
  });

  test('renders signup cards for public web output', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'signup',
          heading: 'Join the newsletter',
          subheading: 'One short digest.',
          buttonText: 'Subscribe',
          emailPlaceholder: 'reader@example.com',
          cardWidth: 'wide',
          version: 1,
        },
      ]),
    );

    expect(out).toContain('class="kg-card kg-signup-card kg-width-wide"');
    expect(out).toContain('<h2 class="kg-signup-card-heading">Join the newsletter</h2>');
    expect(out).toContain('data-members-form="signup"');
    expect(out).toContain('data-members-email');
    expect(out).toContain('placeholder="reader@example.com"');
  });

  test('preserves header subscribe portal buttons', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'header',
          version: 'v2',
          heading: 'Join us',
          buttonText: 'Subscribe',
          buttonUrl: '#/portal/signup',
          buttonPortal: 'signup',
        },
      ]),
    );

    expect(out).toContain('class="kg-header-card-button"');
    expect(out).toContain('href="#/portal/signup"');
    expect(out).toContain('data-portal="signup"');
  });

  test('lazy-loads iframe embed card html', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'embed',
          html: '<iframe src="https://player.vimeo.com/video/76979871" title="Vimeo" loading="eager"></iframe>',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('class="kg-card kg-embed-card"');
    expect(out).toContain(
      '<iframe src="https://player.vimeo.com/video/76979871" title="Vimeo" loading="lazy"></iframe>',
    );
    expect(out).not.toContain('loading="eager"');
  });

  test('preserves responsive attrs on gallery images', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'gallery',
          images: [
            {
              src: '/content/images/gallery/one.jpg',
              alt: 'One',
              srcset:
                '/content/images/size/w600/gallery/one.jpg 600w, /content/images/gallery/one.jpg 1200w',
              sizes: '(min-width: 720px) 720px, 100vw',
            },
          ],
          version: 1,
        },
      ]),
    );
    expect(out).toContain(
      'srcset="/content/images/size/w600/gallery/one.jpg 600w, /content/images/gallery/one.jpg 1200w"',
    );
    expect(out).toContain('sizes="(min-width: 720px) 720px, 100vw"');
  });

  test('drops invalid Koenig cardWidth tokens', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'image',
          src: '/content/images/2024/01/x.jpg',
          cardWidth: 'wide onclick=alert(1)',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('class="kg-card kg-image-card"');
    expect(out).not.toContain('kg-width-wide onclick');
    expect(out).not.toContain('onclick');
  });

  test('renders a code card with language and caption', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'code',
          code: 'console.log("hi");',
          language: 'javascript',
          caption: 'Example',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('<pre><code class="language-javascript">');
    expect(out).toContain('class="kg-card kg-code-card kg-card-hascaption"');
    expect(out).toContain('console.log("hi");');
    expect(out).toContain('>Example</figcaption>');
  });

  test('normalizes Ghost code language names to Prism-compatible aliases', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'code', code: 'echo hi', language: 'Shell', version: 1 }]),
    );
    expect(out).toContain('<code class="language-bash">');
  });

  test('renders legacy image alignment class', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'image', src: '/content/images/a.jpg', align: 'left', version: 1 }]),
    );
    expect(out).toContain('class="kg-card kg-image-card kg-align-left"');
  });

  test('reads node.language for captionless code cards', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'code',
          code: 'const answer: number = 42;',
          language: 'typescript',
          version: 1,
        },
      ]),
    );
    expect(out).toBe(
      '<figure class="kg-card kg-code-card"><button class="kg-code-card-copy" type="button">Copy</button><pre><code class="language-typescript">const answer: number = 42;</code></pre></figure>',
    );
  });

  test('renders an html card inside a kg-card fence', () => {
    const out = renderLexicalToHtml(lex([{ type: 'html', html: '<div>raw</div>', version: 1 }]));
    expect(out).toBe('<!--kg-card-begin: html--><div>raw</div><!--kg-card-end: html-->');
  });

  test('renders a bookmark card with metadata', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'bookmark',
          url: 'https://example.com',
          metadata: {
            title: 'Example',
            description: 'A site',
            publisher: 'Example Inc',
          },
          version: 1,
        },
      ]),
    );
    expect(out).toContain('kg-bookmark-card');
    expect(out).toContain('Example');
    expect(out).toContain('https://example.com');
  });

  test('marks callout cards without an emoji as iconless', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'callout',
          backgroundColor: 'grey',
          calloutText: 'No icon.',
          version: 1,
        },
      ]),
    );
    expect(out).toContain(
      'class="kg-card kg-callout-card kg-callout-card-grey kg-callout-card-without-emoji"',
    );
    expect(out).not.toContain('kg-callout-emoji');
    expect(out).toContain('<div class="kg-callout-text">No icon.</div>');
  });

  test('keeps explicit callout emoji content', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'callout',
          backgroundColor: 'pink',
          calloutEmoji: '✨',
          calloutText: 'Custom icon.',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('class="kg-card kg-callout-card kg-callout-card-pink"');
    expect(out).toContain('<div class="kg-callout-emoji">✨</div>');
    expect(out).not.toContain('kg-callout-card-without-emoji');
  });

  // Regression for backlog task #101: the Source theme grew `kg-video-*`
  // styling that consumes `--aspect-ratio` on `.kg-video-container`. The
  // renderer has to materialise that custom property from the card's
  // width/height payload, otherwise the CSS rule has nothing to bind to
  // and the container collapses to zero height before metadata loads.
  test('renders a video card with --aspect-ratio derived from width/height (#101)', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'video',
          src: '/content/media/clip.mp4',
          thumbnailSrc: '/content/images/poster.jpg',
          width: 1920,
          height: 1080,
          caption: 'A clip',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('kg-video-card');
    expect(out).toContain('kg-card-hascaption');
    expect(out).toContain('kg-video-container');
    expect(out).toContain(`--aspect-ratio: ${1920 / 1080}`);
    expect(out).toContain('poster="/content/images/poster.jpg"');
    expect(out).toContain('>A clip</figcaption>');
  });

  test('renders responsive video poster image metadata', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'video',
          src: '/content/media/clip.mp4',
          thumbnailSrc: '/content/images/poster.jpg',
          thumbnailSrcset: '/content/images/size/w600/poster.jpg 600w',
          thumbnailSizes: '100vw',
          version: 1,
        },
      ]),
    );
    expect(out).toContain('class="kg-video-thumbnail-image-card"');
    expect(out).toContain('srcset="/content/images/size/w600/poster.jpg 600w"');
    expect(out).toContain('sizes="100vw"');
  });

  test('omits --aspect-ratio when width or height is missing (#101)', () => {
    const out = renderLexicalToHtml(
      lex([{ type: 'video', src: '/content/media/clip.mp4', version: 1 }]),
    );
    expect(out).toContain('kg-video-container');
    expect(out).not.toContain('--aspect-ratio');
  });

  test('renders header v2 cards so import turndown can preserve metadata', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'header',
          version: 'v2',
          header: 'Launch headline',
          subheader: 'Useful supporting copy.',
          alignment: 'center',
          layout: 'full',
          style: 'image',
          backgroundImageSrc: 'https://cdn.test/header.jpg',
          backgroundColor: '#101820',
          textColor: '#ffffff',
          buttonUrl: 'https://example.com/signup',
          buttonText: 'Join now',
          buttonColor: '#f6c344',
          buttonTextColor: '#101820',
          accentColor: '#f6c344',
        },
      ]),
    );
    expect(out).toContain('class="kg-card kg-header-card kg-v2 kg-width-full');
    expect(out).toContain('kg-content-wide');
    expect(out).toContain('kg-align-center');
    expect(out).toContain('kg-style-image');
    expect(out).toContain('data-background-color="#101820"');
    expect(out).toContain('data-accent-color="#f6c344"');
    expect(out).toContain('<picture><img class="kg-header-card-image"');
    expect(out).toContain('src="https://cdn.test/header.jpg"');
    expect(out).toContain('data-text-color="#ffffff"');
    expect(out).toContain('data-button-color="#f6c344"');
  });

  test('preserves paywall card boundary, renders signup, and omits email-only cards', () => {
    const out = renderLexicalToHtml(
      lex([
        { type: 'paywall', version: 1 },
        { type: 'email', html: '<p>only members</p>', version: 1 },
        { type: 'email-cta', version: 1 },
        { type: 'signup', version: 1 },
        { type: 'paragraph', children: [text('public')], version: 1 },
      ]),
    );
    expect(out).toContain('<!--members-only-->');
    expect(out).toContain('class="kg-card kg-signup-card"');
    expect(out).toContain('data-members-form="signup"');
    expect(out).toContain('<p>public</p>');
  });

  test('walks children of unknown node types so nested text survives', () => {
    const out = renderLexicalToHtml(
      lex([
        {
          type: 'paragraph',
          children: [
            {
              type: 'something-weird',
              children: [text('still here')],
              version: 1,
            },
          ],
          version: 1,
        },
      ]),
    );
    expect(out).toBe('<p>still here</p>');
  });
});
