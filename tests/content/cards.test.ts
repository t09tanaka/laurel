import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMarkdown } from '~/content/markdown.ts';

// Smoke-test corpus for every Ghost / Koenig card type Nectar's
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

describe('card fixture corpus', () => {
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

  test('image card keeps the kg-image-card wrapper and figure shape', async () => {
    const html = await renderFixture('image');
    expect(html).toContain('class="kg-card kg-image-card kg-width-wide"');
    expect(html).toContain('src="https://cdn.test/cover.jpg"');
    expect(html).toContain('alt="Cover image"');
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="630"');
    expect(html).toContain('<figcaption>Sample cover caption.</figcaption>');
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
    expect(html).toContain('<figure class="kg-card kg-bookmark-card">');
    expect(html).toContain('<a class="kg-bookmark-container" href="https://example.com/post">');
    expect(html).toContain('<div class="kg-bookmark-title">Bookmark Title</div>');
    expect(html).toContain('<div class="kg-bookmark-description">');
    expect(html).toContain('<span class="kg-bookmark-author">Jane Doe</span>');
    expect(html).toContain('<span class="kg-bookmark-publisher">Example</span>');
    expect(html).toContain('class="kg-bookmark-thumbnail"');
    // Shortcode must not leak through verbatim into the rendered HTML.
    expect(html).not.toContain('{{< bookmark');
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
      '{{< embed url="https://www.youtube.com/watch?v=abc123_DEF-4&t=1m5s" provider="youtube" title="A talk" caption="Talk transcript" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-card-hascaption"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abc123_DEF-4?start=65"');
    expect(html).toContain('title="A talk"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allowfullscreen');
    expect(html).toContain('<figcaption>Talk transcript</figcaption>');
    expect(html).not.toContain('{{< embed');
  });

  test('embed shortcode renders Vimeo player URLs as static iframes', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://vimeo.com/76979871" provider="vimeo" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card"');
    expect(html).toContain('src="https://player.vimeo.com/video/76979871"');
    expect(html).toContain('title="Vimeo video"');
  });

  test('embed shortcode renders Spotify URLs as static iframes', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl" provider="spotify" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card"');
    expect(html).toContain('src="https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"');
    expect(html).toContain('height="152"');
    expect(html).toContain('title="Spotify embed"');
  });

  test('embed shortcode leaves script-hydrated providers as fallback links', async () => {
    const { html } = await renderMarkdown(
      '{{< embed url="https://twitter.com/jack/status/20" provider="twitter" caption="Open on Twitter" />}}',
    );
    expect(html).toContain('class="kg-card kg-embed-card kg-card-hascaption"');
    expect(html).toContain('href="https://twitter.com/jack/status/20"');
    expect(html).toContain('<figcaption>Open on Twitter</figcaption>');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<script');
  });

  test('file card keeps the kg-file-card metadata rows', async () => {
    const html = await renderFixture('file');
    expect(html).toContain('class="kg-card kg-file-card"');
    expect(html).toContain('class="kg-file-card-container"');
    expect(html).toContain('href="https://cdn.test/files/resume.pdf"');
    expect(html).toContain('<div class="kg-file-card-title">Resume</div>');
    expect(html).toContain('<div class="kg-file-card-filename">resume.pdf</div>');
    expect(html).toContain('<div class="kg-file-card-filesize">123 KB</div>');
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
    // are HTML comments; sanitize-html drops them by default. The inner
    // markup must reach the rendered output verbatim.
    expect(html).not.toContain('kg-card-begin');
    expect(html).not.toContain('kg-card-end');
    expect(html).toContain('<div class="custom-embed">');
    expect(html).toContain('Raw HTML wrapped in an html card fence.');
  });

  test('code fence renders a <pre><code> block with language hint', async () => {
    const html = await renderFixture('code');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain('export function hello');
    expect(html).toContain('return `Hello, ${name}!`;');
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

  test('signup card scaffold survives sanitisation (form fields are stripped)', async () => {
    const html = await renderFixture('signup');
    // The `kg-signup-card` wrapper + heading + subheading reach the output
    // so a plugin / Portal script can hydrate the form scaffold. The raw
    // `<form>` / `<input>` / `<button>` elements are dropped by the
    // default sanitiser allow-list, which is expected; theme/portal code
    // re-attaches the form at runtime by targeting the kg-signup-card hook.
    expect(html).toContain('class="kg-card kg-signup-card kg-width-regular kg-style-light"');
    expect(html).toContain('<h2 class="kg-signup-card-heading">Join the newsletter</h2>');
    expect(html).toContain('<p class="kg-signup-card-subheading">');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
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
    expect(html).toContain('<details class="kg-card kg-toggle-card">');
    expect(html).toContain('<summary class="kg-toggle-heading">');
    expect(html).toContain('<h4 class="kg-toggle-heading-text">See the details</h4>');
    expect(html).toContain('<div class="kg-toggle-content">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/">link</a>');
    expect(html).not.toContain('{{< toggle');
    expect(html).not.toContain('{{< /toggle');
  });

  test('nft card keeps the kg-nft-card wrapper + image + metadata', async () => {
    const html = await renderFixture('nft');
    expect(html).toContain('class="kg-card kg-nft-card"');
    expect(html).toContain('class="kg-nft-card-container"');
    expect(html).toContain('href="https://opensea.io/assets/example/1"');
    expect(html).toContain('class="kg-nft-image"');
    expect(html).toContain('<div class="kg-nft-title">Sample NFT</div>');
    expect(html).toContain('<div class="kg-nft-creator">by example</div>');
  });

  // Newsletter card pipeline (#129):
  //   - `kg-email-cta-card`: stripped at render time (web build), never reaches readers.
  //   - `kg-signup-card`: passes through to the theme/portal adapter (covered above).
  //   - `kg-paywall-card`: not stripped; the loader's marker pass
  //     (`src/content/paywall.ts`) handles the cut and the div is left in
  //     place for any theme that styles it.

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
