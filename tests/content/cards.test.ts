import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMarkdown } from '~/content/markdown.ts';

// Smoke-test corpus for every Ghost / Koenig card type Laurel's
// `renderMarkdown` is expected to round-trip. Each fixture under
// `tests/fixtures/cards/<name>.md` documents the canonical input shape;
// the regression assertions below pin the structural HTML output so a
// future markdown / sanitisation tweak that silently strips a card
// shows up as a test failure.
//
// See `tests/fixtures/cards/README.md` for the corpus design.

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'cards');

async function renderFixture(name: string): Promise<string> {
  const src = await readFile(join(FIXTURE_DIR, `${name}.md`), 'utf8');
  const { html } = await renderMarkdown(src);
  return html;
}

function normalizeIntertagWhitespace(html: string): string {
  return html.replace(/>\s+</g, '><').trim();
}

function getFigcaptionHtml(html: string): string {
  return html.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/)?.[1] ?? '';
}

describe('card fixture corpus', () => {
  test('card spacing contract keeps kg-card roots as gh-content direct children', async () => {
    const md = [
      'Intro paragraph.',
      '',
      '<div class="laurel-card" id="wrapper"><figure id="hello-heading" class="kg-card kg-image-card kg-width-full"><img src="https://cdn.test/a.jpg" alt=""></figure></div>',
      '',
      '{{< audio src="https://cdn.test/audio.mp3" title="Episode" />}}',
      '',
      'Outro paragraph.',
    ].join('\n');

    const { html } = await renderMarkdown(md);

    expect(html).toBe(
      '<p>Intro paragraph.</p>\n' +
        '<figure class="kg-card kg-image-card kg-width-full"><img src="https://cdn.test/a.jpg" alt></figure>\n' +
        '\n\n\n' +
        '<div class="kg-card kg-audio-card kg-width-regular"><audio src="https://cdn.test/audio.mp3" preload="metadata" controls></audio><div class="kg-audio-title">Episode</div></div>\n' +
        '\n\n\n' +
        '<p>Outro paragraph.</p>\n',
    );
    expect(html).not.toContain('laurel-card');
    expect(html).not.toContain('id="hello-heading"');
    expect(html).not.toMatch(/<[^>]*\bclass="[^"]*\bkg-card\b[^"]*"[^>]*\bid=/);
    expect(html).not.toMatch(/<[^>]*\bid="[^"]*"[^>]*\bclass="[^"]*\bkg-card\b/);
  });

  test('keeps the major Casper-family Koenig card wrapper classes', async () => {
    const requiredWrappers = [
      ['bookmark', 'kg-bookmark-card'],
      ['gallery', 'kg-gallery-card'],
      ['callout', 'kg-callout-card'],
      ['button', 'kg-button-card'],
      ['product', 'kg-product-card'],
      ['toggle', 'kg-toggle-card'],
      ['file', 'kg-file-card'],
      ['audio', 'kg-audio-card'],
      ['video', 'kg-video-card'],
      ['header', 'kg-header-card'],
      ['nft', 'kg-nft-card'],
      ['signup', 'kg-signup-card'],
    ] as const;

    for (const [fixture, wrapperClass] of requiredWrappers) {
      const html = await renderFixture(fixture);
      expect(html).toContain(wrapperClass);
    }
  });

  test('import-emitted Koenig shortcodes expand to kg-card wrappers', async () => {
    const cases = [
      [
        'bookmark',
        '{{< bookmark url="https://example.com/post" title="Bookmark Title" />}}',
        'kg-bookmark-card',
      ],
      [
        'callout',
        '{{< callout emoji="!" color="blue" >}}\nHeads up.\n{{< /callout >}}',
        'kg-callout-card',
      ],
      [
        'gallery',
        '{{< gallery size="wide" >}}\n{{< gallery-row >}}\n{{< gallery-image src="https://cdn.test/g1.jpg" alt="One" width="600" height="400" />}}\n{{< /gallery-row >}}\n{{< /gallery >}}',
        'kg-gallery-card',
      ],
      ['audio', '{{< audio src="https://cdn.test/audio.mp3" title="Episode" />}}', 'kg-audio-card'],
      [
        'video',
        '{{< video src="https://cdn.test/video.mp4" width="1280" height="720" controls="true" />}}',
        'kg-video-card',
      ],
      [
        'button',
        '{% button href="https://example.com/buy" text="Buy now" align="center" style="accent" %}',
        'kg-button-card',
      ],
      [
        'product',
        '{{< product title="Widget" description="Useful." image="https://cdn.test/product.jpg" button-href="https://example.com/buy" button-text="Buy" />}}',
        'kg-product-card',
      ],
      [
        'header',
        '{% header style="dark" title="A bold header card" subtitle="Subheading text." cta-text="Get started" cta-href="https://example.com/cta" card-size="large" %}',
        'kg-header-card',
      ],
      [
        'toggle',
        '{{< toggle heading="See the details" >}}\nThe body.\n{{< /toggle >}}',
        'kg-toggle-card',
      ],
      [
        'nft',
        '{{< nft href="https://opensea.io/assets/example/1" image="https://cdn.test/nft.jpg" title="Sample NFT" creator="by example" />}}',
        'kg-nft-card',
      ],
    ] as const;

    for (const [label, markdown, wrapperClass] of cases) {
      const { html } = await renderMarkdown(markdown);
      expect(html, `${label} shortcode should not leak through verbatim`).not.toContain('{{<');
      expect(html, `${label} should render its Koenig card wrapper`).toContain(wrapperClass);
    }
  });

  test('image card keeps the kg-image-card wrapper and figure shape', async () => {
    const html = await renderFixture('image');
    expect(html).toContain('class="kg-card kg-image-card kg-width-wide"');
    expect(html).toContain('src="https://cdn.test/cover.jpg"');
    expect(html).toContain('alt="Cover image"');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="630"');
    expect(html).toContain('<figcaption>Sample cover caption.</figcaption>');
  });

  test('figure shortcode strips Ghost URL placeholders from responsive image attrs', async () => {
    const { html } = await renderMarkdown(
      '{{< figure src="__GHOST_URL__/content/images/2024/01/photo.jpg" srcset="__GHOST_URL__/content/images/size/w600/photo.jpg 600w, __GHOST_URL__/content/images/photo.jpg 1200w" sizes="(min-width: 720px) 720px, 100vw" alt="Photo" />}}',
    );
    expect(html).not.toContain('__GHOST_URL__');
    expect(html).toContain('src="/content/images/2024/01/photo.jpg"');
    expect(html).toContain(
      'srcset="/content/images/size/w600/photo.jpg 600w, /content/images/photo.jpg 1200w"',
    );
    expect(html).toContain('sizes="(min-width: 720px) 720px, 100vw"');
  });

  test('figure shortcode renders caption as sanitized inline markdown', async () => {
    const { html } = await renderMarkdown(
      [
        '{{< figure src="https://cdn.test/cover.jpg" alt="Cover"',
        'caption="Photo by **Jane** and [Laurel](https://laurel.test/about) ![tracking](https://evil.test/pixel.jpg)<figure><img src=https://evil.test/nested.jpg></figure>" />}}',
      ].join(' '),
    );

    const figcaption = getFigcaptionHtml(html);
    expect(figcaption).toContain('<strong>Jane</strong>');
    expect(figcaption).toContain('<a href="https://laurel.test/about">Laurel</a>');
    expect(figcaption).not.toContain('<img');
    expect(figcaption).not.toContain('<figure');
  });

  test('plain raw img strips Ghost URL placeholders without dropping srcset or sizes', async () => {
    const { html } = await renderMarkdown(
      '<p><img src="__GHOST_URL__/content/images/2024/01/plain.jpg" srcset="__GHOST_URL__/content/images/size/w600/plain.jpg 600w, __GHOST_URL__/content/images/plain.jpg 1200w" sizes="100vw" alt="Plain"></p>',
    );
    expect(html).not.toContain('__GHOST_URL__');
    expect(html).toContain('src="/content/images/2024/01/plain.jpg"');
    expect(html).toContain(
      'srcset="/content/images/size/w600/plain.jpg 600w, /content/images/plain.jpg 1200w"',
    );
    expect(html).toContain('sizes="100vw"');
  });

  test('gallery card preserves the kg-gallery-container row structure', async () => {
    const html = await renderFixture('gallery');
    expect(html).toContain('class="kg-card kg-gallery-card kg-width-wide"');
    expect(html).toContain('<div class="kg-gallery-container">');
    expect(html).toContain('<div class="kg-gallery-row">');
    expect((html.match(/kg-gallery-image/g) ?? []).length).toBe(3);
    expect(html).toMatch(
      /<div class="kg-gallery-image"><img\b[^>]*\bsrc="https:\/\/cdn\.test\/g1\.jpg"[^>]*\bwidth="600"[^>]*\bheight="400"[^>]*><\/div>/,
    );
    expect(html).toContain('src="https://cdn.test/g1.jpg"');
    expect(html).toContain('src="https://cdn.test/g3.jpg"');
    expect(html).toContain('<figcaption>A three-image gallery.</figcaption>');
  });

  test('bookmark shortcode expands into the kg-bookmark-card figure', async () => {
    const html = await renderFixture('bookmark');
    expect(html).toContain('<figure class="kg-card kg-bookmark-card kg-width-regular">');
    expect(html).toContain('<a class="kg-bookmark-container" href="https://example.com/post">');
    expect(html).toContain('<div class="kg-bookmark-title">Bookmark Title</div>');
    expect(html).toContain('<div class="kg-bookmark-description">');
    expect(html).toContain('<span class="kg-bookmark-author">Jane Doe</span>');
    expect(html).toContain('<span class="kg-bookmark-publisher">Example</span>');
    expect(html).toContain('class="kg-bookmark-thumbnail"');
    // Shortcode must not leak through verbatim into the rendered HTML.
    expect(html).not.toContain('{{< bookmark');
  });

  test('bookmark shortcode matches the Ghost DOM contract modulo whitespace', async () => {
    const html = await renderFixture('bookmark');

    expect(normalizeIntertagWhitespace(html)).toBe(
      normalizeIntertagWhitespace(`
        <figure class="kg-card kg-bookmark-card kg-width-regular">
          <a class="kg-bookmark-container" href="https://example.com/post">
            <div class="kg-bookmark-content">
              <div class="kg-bookmark-title">Bookmark Title</div>
              <div class="kg-bookmark-description">A short summary of the linked article.</div>
              <div class="kg-bookmark-metadata">
                <img class="kg-bookmark-icon" src="https://example.com/icon.png" alt="" />
                <span class="kg-bookmark-author">Jane Doe</span>
                <span class="kg-bookmark-publisher">Example</span>
              </div>
            </div>
            <div class="kg-bookmark-thumbnail">
              <img src="https://example.com/thumb.jpg" alt="" />
            </div>
          </a>
        </figure>
      `),
    );
  });

  test('callout card keeps emoji + text wrappers with colour modifier class', async () => {
    const html = await renderFixture('callout');
    expect(html).toContain('class="kg-card kg-callout-card kg-callout-card-blue"');
    expect(html).toContain('<div class="kg-callout-emoji">');
    expect(html).toContain('<div class="kg-callout-text">Heads up: this is a callout card.</div>');
  });

  test('button card keeps alignment modifier + kg-btn anchor', async () => {
    const html = await renderFixture('button');
    expect(html).toContain('class="kg-card kg-button-card kg-align-center"');
    expect(html).toContain('href="https://example.com/buy"');
    expect(html).toContain('class="kg-btn kg-btn-accent"');
    expect(html).toContain('>Buy now</a>');
  });

  test('embed card keeps the kg-embed-card figure + fallback link', async () => {
    const html = await renderFixture('embed');
    expect(html).toContain('class="kg-card kg-embed-card"');
    expect(html).toContain('href="https://twitter.com/jack/status/20"');
    expect(html).toContain('<figcaption>');
  });

  test('embed shortcode renders YouTube as a static privacy-enhanced iframe', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://www.youtube.com/watch?v=abc123_DEF-4&t=1m5s" provider="youtube" title="A talk" size="wide" caption="Talk transcript" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-wide kg-card-hascaption"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abc123_DEF-4?start=65"');
    expect(html).toContain('title="A talk"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allowfullscreen');
    expect(getFigcaptionHtml(html)).toBe('Talk transcript');
    expect(html).not.toContain('{{< embed');
  });

  test('embed shortcode renders Vimeo player URLs as static iframes', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://vimeo.com/76979871" provider="vimeo" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-regular"');
    expect(html).toContain('src="https://player.vimeo.com/video/76979871"');
    expect(html).toContain('title="Vimeo video"');
    expect(html).toContain('loading="lazy"');
  });

  test('embed shortcode renders Spotify URLs as static iframes', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl" provider="spotify" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-regular"');
    expect(html).toContain('src="https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"');
    expect(html).toContain('height="152"');
    expect(html).toContain('title="Spotify embed"');
    expect(html).toContain('loading="lazy"');
  });

  test('embed shortcode leaves script-hydrated providers as fallback links', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://twitter.com/jack/status/20" provider="twitter" caption="Open on Twitter" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-regular kg-card-hascaption"');
    expect(html).toContain('data-laurel-embed-provider="twitter"');
    expect(html).toContain('class="kg-bookmark-container kg-embed-card-fallback"');
    expect(html).toContain('href="https://twitter.com/jack/status/20"');
    expect(html).toContain('Twitter/X embed');
    expect(getFigcaptionHtml(html)).toBe('Open on Twitter');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  test('twitter embed fallback preserves dnt privacy as a source URL query', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://twitter.com/jack/status/20" provider="twitter" dnt="true" blockquote-class="twitter-tweet" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-regular"');
    expect(html).toContain('href="https://twitter.com/jack/status/20?dnt=1"');
    expect(html).toContain('Twitter/X embed');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  test('embed shortcode renders unsupported providers as bookmark-style source links', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://www.figma.com/file/abc/Design" provider="figma" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-width-regular"');
    expect(html).toContain('class="kg-bookmark-container kg-embed-card-fallback"');
    expect(html).toContain('href="https://www.figma.com/file/abc/Design"');
    expect(html).toContain('Figma embed');
    expect(html).toContain('Open this Figma embed at its source URL.');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  test('file card keeps the Ghost download card DOM contract', async () => {
    const html = await renderFixture('file');
    expect(normalizeIntertagWhitespace(html)).toBe(
      normalizeIntertagWhitespace(`
        <div class="kg-card kg-file-card">
          <a class="kg-file-card-container" href="https://cdn.test/files/resume.pdf" download>
            <div class="kg-file-card-contents">
              <div class="kg-file-card-title">Resume</div>
              <div class="kg-file-card-caption">Short PDF download.</div>
              <div class="kg-file-card-metadata">
                <div class="kg-file-card-filename">resume.pdf</div>
                <div class="kg-file-card-filesize">123 KB</div>
              </div>
            </div>
            <div class="kg-file-card-icon">
              <svg viewbox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </div>
          </a>
        </div>
      `),
    );
  });

  test('audio card keeps the audio element + thumbnail + title rows', async () => {
    const html = await renderFixture('audio');
    expect(html).toContain('class="kg-card kg-audio-card"');
    expect(html).toContain('<audio src="https://cdn.test/audio/episode-1.mp3"');
    expect(html).toContain('controls');
    expect(html).toContain('class="kg-audio-thumbnail"');
    expect(html).toContain('<div class="kg-audio-title">Episode 1: pilot</div>');
    expect(html).toContain('<div class="kg-audio-duration">00:42:13</div>');
  });

  test('video card keeps the kg-video-container + video element', async () => {
    const html = await renderFixture('video');
    expect(html).toContain('class="kg-card kg-video-card"');
    expect(html).toContain('class="kg-video-container"');
    expect(html).toContain('<video src="https://cdn.test/video/clip.mp4"');
    expect(html).toContain('poster="https://cdn.test/video/clip-poster.jpg"');
    expect(html).toContain('width="1280"');
    expect(html).toContain('height="720"');
    expect(html).toContain('controls');
  });

  test('header card keeps the kg-header-card wrapper + heading + CTA anchor', async () => {
    const html = await renderFixture('header');
    expect(html).toContain('class="kg-card kg-header-card kg-style-dark kg-size-large"');
    expect(html).toContain('<h2 class="kg-header-card-heading">A bold header card</h2>');
    expect(html).toContain('<h3 class="kg-header-card-subheading">Subheading text.</h3>');
    expect(html).toContain('class="kg-header-card-button"');
    expect(html).toContain('href="https://example.com/cta"');
  });

  test('html card fence is stripped, inner raw HTML survives', async () => {
    const html = await renderFixture('html');
    // The `<!--kg-card-begin: html-->` / `<!--kg-card-end: html-->` markers
    // are converted back to Ghost's kg-html-card wrapper so theme card spacing
    // and width rules can match the custom HTML block.
    expect(html).not.toContain('kg-card-begin');
    expect(html).not.toContain('kg-card-end');
    expect(html).toContain('<div class="kg-card kg-html-card">');
    expect(html).toContain('<div class="custom-embed">');
    expect(html).toContain('Raw HTML wrapped in an html card fence.');
  });

  test('code fence renders a highlighted <pre><code> block with language hint', async () => {
    const html = await renderFixture('code');
    expect(html).toContain('<pre class="shiki');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<span style="color:');
    expect(html).toContain('export');
    expect(html).toContain('Hello, ${');
    expect(html).toContain('</code></pre>');
  });

  test('markdown card fence is stripped, inner HTML survives', async () => {
    const html = await renderFixture('markdown');
    expect(html).not.toContain('kg-card-begin');
    expect(html).not.toContain('kg-card-end');
    expect(html).toContain('<p>Raw paragraph from a Koenig markdown card.</p>');
    expect(html).toContain('<li>One</li>');
    expect(html).toContain('<li>Two</li>');
  });

  test('paywall fence comment is dropped at render time, body paragraphs survive', async () => {
    // `<!--kg-card-begin: paywall-->` is processed by the content loader's
    // paywall pass (see `src/content/paywall.ts`), not by `renderMarkdown`
    // — so at this layer the fence is just an empty HTML comment and only
    // the surrounding markdown paragraphs reach the output.
    const html = await renderFixture('paywall');
    expect(html).not.toContain('kg-card-begin');
    expect(html).not.toContain('kg-card-end');
    expect(html).toContain('<p>Free preview paragraph.</p>');
    expect(html).toContain('<p>Members-only paragraph that lives below the paywall fence.</p>');
  });

  test('signup card scaffold preserves Ghost members form hooks', async () => {
    const html = await renderFixture('signup');
    expect(html).toContain('class="kg-card kg-signup-card kg-width-regular kg-style-light"');
    expect(html).toContain('<h2 class="kg-signup-card-heading">Join the newsletter</h2>');
    expect(html).toContain('<p class="kg-signup-card-subheading">');
    expect(html).toMatch(/<form[^>]*\bdata-members-form="signup"/);
    expect(html).toMatch(/<input[^>]*\bdata-members-email/);
    expect(html).toMatch(/<button[^>]*\bdata-members-submit/);
  });

  test('recommendations card scaffold survives sanitisation', async () => {
    const html = await renderFixture('recommendations');
    expect(html).toContain('class="kg-card kg-recommendations-card"');
    // `data-limit` attribute is dropped by the default sanitiser allow-list;
    // hydration logic targets the kg-recommendations-card hook directly.
    expect(html).not.toContain('data-limit');
    expect(html).toContain('class="kg-recommendation"');
    expect(html).toContain('href="https://blog-a.example.com/"');
  });

  test('product card keeps the container + title + description + CTA', async () => {
    const html = await renderFixture('product');
    expect(html).toContain('class="kg-card kg-product-card"');
    expect(html).toContain('<div class="kg-product-card-title">Sample widget</div>');
    expect(html).toContain('<div class="kg-product-card-description">');
    expect(html).toContain('class="kg-product-card-button kg-product-card-btn-accent"');
    expect(html).toContain('href="https://example.com/buy"');
  });

  test('toggle shortcode expands into a <details> with kg-toggle-card hooks', async () => {
    const html = await renderFixture('toggle');
    expect(html).toContain('<details class="kg-card kg-toggle-card kg-width-regular">');
    expect(html).toContain('<summary class="kg-toggle-heading">');
    expect(html).toContain('<h4 class="kg-toggle-heading-text">See the details</h4>');
    expect(html).toContain('<div class="kg-toggle-content">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/">link</a>');
    expect(html).not.toContain('{{< toggle');
    expect(html).not.toContain('{{< /toggle');
  });

  test('nft shortcode expands into the kg-nft-card wrapper + image + metadata', async () => {
    const html = await renderFixture('nft');
    expect(html).toContain('class="kg-card kg-nft-card kg-width-regular"');
    expect(html).toContain('class="kg-nft-card-container"');
    expect(html).toContain('href="https://opensea.io/assets/example/1"');
    expect(html).toContain('class="kg-nft-image"');
    expect(html).toContain('<div class="kg-nft-title">Sample NFT</div>');
    expect(html).toContain('<div class="kg-nft-creator">by example</div>');
    expect(html).not.toContain('{{< nft');
  });

  // Newsletter card pipeline (#129):
  //   - `kg-email-card` / `kg-email-cta-card`: stripped at render time (web build),
  //     never reaches readers or derived plaintext.
  //   - `kg-signup-card`: passes through to the theme/portal adapter (covered above).
  //   - `kg-paywall-card`: not stripped; the loader's marker pass
  //     (`src/content/paywall.ts`) handles the cut and the div is left in
  //     place for any theme that styles it.

  test('email-card is stripped from rendered HTML and plaintext', async () => {
    const md = [
      'Public paragraph before the email-only region.',
      '',
      '<div class="kg-card kg-email-card">',
      '<p>Newsletter body secret.</p>',
      '<div class="kg-button-card">Email-only nested CTA</div>',
      '</div>',
      '',
      'Public paragraph after the email-only region.',
    ].join('\n');
    const { html, plaintext } = await renderMarkdown(md);
    expect(html).not.toContain('kg-email-card');
    expect(html).not.toContain('Newsletter body secret');
    expect(html).not.toContain('Email-only nested CTA');
    expect(plaintext).not.toContain('Newsletter body secret');
    expect(plaintext).not.toContain('Email-only nested CTA');
    expect(html).toContain('Public paragraph before the email-only region.');
    expect(html).toContain('Public paragraph after the email-only region.');
    expect(plaintext).toContain('Public paragraph before the email-only region.');
    expect(plaintext).toContain('Public paragraph after the email-only region.');
  });

  test('email-cta-card is stripped from rendered HTML so web readers never see it', async () => {
    const md = [
      '<div class="kg-card kg-email-cta-card kg-style-segment">',
      '<p>Get this in your inbox every week.</p>',
      '<a href="#/portal/signup">Subscribe</a>',
      '</div>',
      '',
      'Regular paragraph after the CTA.',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-email-cta-card');
    expect(html).not.toContain('Get this in your inbox');
    expect(html).not.toContain('href="#/portal/signup"');
    expect(html).toContain('Regular paragraph after the CTA.');
  });

  test('email-cta-card stripping survives nested <div> inside the card body', async () => {
    const md = [
      '<div class="kg-card kg-email-cta-card">',
      '<div class="kg-email-cta-content">',
      '<p>Inner copy with a <strong>nested</strong> emphasis.</p>',
      '</div>',
      '</div>',
      '',
      'Surviving body content.',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-email-cta-card');
    expect(html).not.toContain('kg-email-cta-content');
    expect(html).not.toContain('Inner copy');
    expect(html).toContain('Surviving body content.');
  });

  test('paywall-card markup is preserved (loader handles the cut via the marker comment)', async () => {
    const md = [
      '<div class="kg-card kg-paywall-card">',
      '<p>This is a Koenig paywall placeholder rendered by Ghost.</p>',
      '</div>',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).toContain('kg-paywall-card');
  });

  test('multiple email-cta-cards in the same document are all stripped', async () => {
    const md = [
      '<div class="kg-card kg-email-cta-card">A</div>',
      '',
      'Middle paragraph.',
      '',
      '<div class="kg-card kg-email-cta-card kg-style-light">B</div>',
      '',
      'Closing paragraph.',
    ].join('\n');
    const { html } = await renderMarkdown(md);
    expect(html).not.toContain('kg-email-cta-card');
    expect(html).not.toContain('>A<');
    expect(html).not.toContain('>B<');
    expect(html).toContain('Middle paragraph.');
    expect(html).toContain('Closing paragraph.');
  });
});
