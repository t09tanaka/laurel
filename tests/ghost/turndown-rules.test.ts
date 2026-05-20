import { describe, expect, test } from 'bun:test';
import {
  createGhostTurndown,
  preprocessKoenigCardFences,
  sanitizeImportedHtmlCard,
} from '~/ghost/turndown-rules.ts';

const td = createGhostTurndown();

describe('Ghost Turndown rules — kg-bookmark-card', () => {
  test('preserves url, title, description, author, publisher, thumbnail, icon', () => {
    const html = `
      <figure class="kg-card kg-bookmark-card">
        <a class="kg-bookmark-container" href="https://example.com/post">
          <div class="kg-bookmark-content">
            <div class="kg-bookmark-title">Title Here</div>
            <div class="kg-bookmark-description">A description.</div>
            <div class="kg-bookmark-metadata">
              <img class="kg-bookmark-icon" src="https://example.com/icon.png" />
              <span class="kg-bookmark-author">Jane</span>
              <span class="kg-bookmark-publisher">Example</span>
            </div>
          </div>
          <div class="kg-bookmark-thumbnail">
            <img src="https://example.com/thumb.jpg" alt="" />
          </div>
        </a>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< bookmark');
    expect(md).toContain('url="https://example.com/post"');
    expect(md).toContain('title="Title Here"');
    expect(md).toContain('description="A description."');
    expect(md).toContain('author="Jane"');
    expect(md).toContain('publisher="Example"');
    expect(md).toContain('icon="https://example.com/icon.png"');
    expect(md).toContain('thumbnail="https://example.com/thumb.jpg"');
    expect(md).toContain('/>}}');
  });

  test('omits empty attributes', () => {
    const html = `
      <figure class="kg-card kg-bookmark-card">
        <a class="kg-bookmark-container" href="https://example.com/">
          <div class="kg-bookmark-content">
            <div class="kg-bookmark-title">Only Title</div>
          </div>
        </a>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('title="Only Title"');
    expect(md).not.toContain('description=""');
    expect(md).not.toContain('thumbnail=""');
    expect(md).not.toContain('author=""');
  });
});

describe('Ghost Turndown rules — kg-header-card', () => {
  test('preserves v1 layout metadata as a header shortcode', () => {
    const html = `
      <div class="kg-card kg-header-card kg-style-dark kg-size-large">
        <h2 class="kg-header-card-heading">A bold header card</h2>
        <h3 class="kg-header-card-subheading">Subheading text.</h3>
        <a class="kg-header-card-button" href="https://example.com/cta">Get started</a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{% header');
    expect(md).toContain('style="dark"');
    expect(md).toContain('card-size="large"');
    expect(md).toContain('title="A bold header card"');
    expect(md).toContain('subtitle="Subheading text."');
    expect(md).toContain('cta-href="https://example.com/cta"');
    expect(md).toContain('cta-text="Get started"');
  });

  test('preserves v2 alignment, width, background, color, button, and accent metadata', () => {
    const html = `
      <div
        class="kg-card kg-header-card kg-v2 kg-width-full kg-align-center kg-content-wide kg-style-image"
        style="--bg-image-position: 45% 35%; --bg-image-color: #101820; background-color: #101820;"
        data-background-color="#101820"
        data-accent-color="#f6c344"
      >
        <picture>
          <img class="kg-header-card-image" src="https://cdn.test/header.jpg" width="1600" height="900" alt="" />
        </picture>
        <div class="kg-header-card-content">
          <div class="kg-header-card-text kg-align-center">
            <h2 class="kg-header-card-heading" style="color: #ffffff;" data-text-color="#ffffff">Launch headline</h2>
            <p class="kg-header-card-subheading" style="color: #f4f4f4;" data-text-color="#f4f4f4">Useful supporting copy.</p>
            <a
              class="kg-header-card-button kg-header-card-button-accent"
              style="background-color: #f6c344; color: #101820;"
              data-button-color="#f6c344"
              href="https://example.com/signup"
            >Join now</a>
          </div>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< header');
    expect(md).toContain('version="v2"');
    expect(md).toContain('align="center"');
    expect(md).toContain('width="full"');
    expect(md).toContain('content_width="wide"');
    expect(md).toContain('style="image"');
    expect(md).toContain('background_image="https://cdn.test/header.jpg"');
    expect(md).toContain('background_image_width="1600"');
    expect(md).toContain('background_image_height="900"');
    expect(md).toContain('background_image_position="45% 35%"');
    expect(md).toContain('background_image_color="#101820"');
    expect(md).toContain('background_color="#101820"');
    expect(md).toContain('text_color="#ffffff"');
    expect(md).toContain('button_color="#f6c344"');
    expect(md).toContain('button_style="accent"');
    expect(md).toContain('accent="#f6c344"');
    expect(md).toContain('heading="Launch headline"');
    expect(md).toContain('subheading="Useful supporting copy."');
    expect(md).toContain('button_href="https://example.com/signup"');
    expect(md).toContain('button_text="Join now"');
  });
});

describe('Ghost Turndown rules — kg-image-card', () => {
  test('preserves caption, alt, dimensions, and width modifier', () => {
    const html = `
      <figure class="kg-card kg-image-card kg-width-wide">
        <img src="/content/images/hero.jpg" alt="Hero shot" width="2000" height="1200" />
        <figcaption>Photo by Jane</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('src="/content/images/hero.jpg"');
    expect(md).toContain('alt="Hero shot"');
    expect(md).toContain('width="2000"');
    expect(md).toContain('height="1200"');
    expect(md).toContain('size="wide"');
    expect(md).toContain('caption="Photo by Jane"');
  });

  test('renders without caption when figcaption is absent', () => {
    const html = `
      <figure class="kg-card kg-image-card">
        <img src="/content/images/hero.jpg" alt="Hero" />
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('src="/content/images/hero.jpg"');
    expect(md).not.toContain('caption=');
  });

  test('preserves wrapping anchor href as the image click target', () => {
    const html = `
      <figure class="kg-card kg-image-card kg-card-hascaption">
        <a href="https://target.example/">
          <img src="/content/images/hero.jpg" class="kg-image" alt="Hero" width="2000" height="1200" />
        </a>
        <figcaption>By <a href="https://author.example/">Jane</a></figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('href="https://target.example/"');
    // The caption's inner anchor must not be mistaken for the wrap href.
    expect(md).not.toContain('href="https://author.example/"');
    expect(md).toContain('caption=');
  });

  test('omits href when img is not wrapped in an anchor', () => {
    const html = `
      <figure class="kg-card kg-image-card">
        <img src="/content/images/plain.jpg" alt="Plain" />
        <figcaption>See <a href="https://elsewhere.example/">elsewhere</a></figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).not.toContain('href=');
  });

  test('preserves srcset and sizes from the inner img', () => {
    const html = `
      <figure class="kg-card kg-image-card kg-width-full">
        <img
          src="/content/images/hero.jpg"
          srcset="/content/images/size/w600/hero.jpg 600w, /content/images/size/w1000/hero.jpg 1000w, /content/images/hero.jpg 2000w"
          sizes="(min-width: 1200px) 1000px, 100vw"
          alt="Hero"
          width="2000"
          height="1200"
        />
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('size="full"');
    expect(md).toContain(
      'srcset="/content/images/size/w600/hero.jpg 600w, /content/images/size/w1000/hero.jpg 1000w, /content/images/hero.jpg 2000w"',
    );
    expect(md).toContain('sizes="(min-width: 1200px) 1000px, 100vw"');
  });

  test('plain raw img preserves srcset and sizes via figure shortcode', () => {
    const html = `
      <p>
        <img
          src="/content/images/plain.jpg"
          srcset="/content/images/size/w600/plain.jpg 600w, /content/images/plain.jpg 1200w"
          sizes="100vw"
          alt="Plain"
        />
      </p>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('src="/content/images/plain.jpg"');
    expect(md).toContain(
      'srcset="/content/images/size/w600/plain.jpg 600w, /content/images/plain.jpg 1200w"',
    );
    expect(md).toContain('sizes="100vw"');
  });
});

describe('Ghost Turndown rules — kg-gallery-card', () => {
  test('preserves per-row grouping, image dimensions, and figcaption', () => {
    const html = `
      <figure class="kg-card kg-gallery-card kg-width-wide">
        <div class="kg-gallery-container">
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/a.jpg" alt="A" width="800" height="600" /></div>
            <div class="kg-gallery-image"><img src="/img/b.jpg" alt="B" width="1200" height="800" /></div>
            <div class="kg-gallery-image"><img src="/img/c.jpg" alt="C" width="900" height="900" /></div>
          </div>
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/d.jpg" alt="D" width="1600" height="900" /></div>
            <div class="kg-gallery-image"><img src="/img/e.jpg" alt="E" width="1000" height="1500" /></div>
          </div>
        </div>
        <figcaption>Roll one</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< gallery caption="Roll one" size="wide" >}}');
    expect(md).toContain('{{< gallery-row >}}');
    expect(md).toContain('{{< /gallery-row >}}');
    expect(md).toContain(
      '{{< gallery-image src="/img/a.jpg" alt="A" width="800" height="600" />}}',
    );
    expect(md).toContain(
      '{{< gallery-image src="/img/b.jpg" alt="B" width="1200" height="800" />}}',
    );
    expect(md).toContain(
      '{{< gallery-image src="/img/c.jpg" alt="C" width="900" height="900" />}}',
    );
    expect(md).toContain(
      '{{< gallery-image src="/img/d.jpg" alt="D" width="1600" height="900" />}}',
    );
    expect(md).toContain(
      '{{< gallery-image src="/img/e.jpg" alt="E" width="1000" height="1500" />}}',
    );
    expect(md).toContain('{{< /gallery >}}');

    // Row grouping is preserved: two distinct row blocks, in source order.
    const rowOpenCount = (md.match(/\{\{< gallery-row >\}\}/g) ?? []).length;
    const rowCloseCount = (md.match(/\{\{< \/gallery-row >\}\}/g) ?? []).length;
    expect(rowOpenCount).toBe(2);
    expect(rowCloseCount).toBe(2);
    expect(md.indexOf('/img/c.jpg')).toBeLessThan(md.indexOf('/img/d.jpg'));
  });

  test('omits width/height attributes that are missing on the source img', () => {
    const html = `
      <figure class="kg-card kg-gallery-card">
        <div class="kg-gallery-container">
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/a.jpg" alt="A" /></div>
          </div>
        </div>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< gallery-image src="/img/a.jpg" alt="A" />}}');
    expect(md).not.toContain('width=""');
    expect(md).not.toContain('height=""');
    expect(md).not.toContain('caption=');
  });

  test('falls back to a single synthesized row when no kg-gallery-row wrappers exist', () => {
    const html = `
      <figure class="kg-card kg-gallery-card">
        <div class="kg-gallery-container">
          <div class="kg-gallery-image"><img src="/img/a.jpg" alt="A" width="100" height="50" /></div>
          <div class="kg-gallery-image"><img src="/img/b.jpg" alt="B" width="200" height="100" /></div>
        </div>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< gallery');
    expect((md.match(/\{\{< gallery-row >\}\}/g) ?? []).length).toBe(1);
    expect(md).toContain('{{< gallery-image src="/img/a.jpg" alt="A" width="100" height="50" />}}');
    expect(md).toContain(
      '{{< gallery-image src="/img/b.jpg" alt="B" width="200" height="100" />}}',
    );
  });

  test('deduplicates repeated src across rows', () => {
    const html = `
      <figure class="kg-card kg-gallery-card">
        <div class="kg-gallery-container">
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/a.jpg" alt="A" /></div>
          </div>
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/a.jpg" alt="Dup" /></div>
            <div class="kg-gallery-image"><img src="/img/b.jpg" alt="B" /></div>
          </div>
        </div>
      </figure>
    `;
    const md = td.turndown(html);
    const occurrences = (md.match(/src="\/img\/a\.jpg"/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(md).toContain('src="/img/b.jpg"');
  });
});

describe('Ghost Turndown rules — kg-embed-card', () => {
  test('preserves iframe url, caption, and dimensions', () => {
    const html = `
      <figure class="kg-card kg-embed-card kg-width-wide">
        <iframe src="https://www.youtube.com/embed/abc123" title="A talk" width="560" height="315"></iframe>
        <figcaption>Talk transcript</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('url="https://www.youtube.com/embed/abc123"');
    expect(md).toContain('provider="youtube"');
    expect(md).toContain('title="A talk"');
    expect(md).toContain('width="560"');
    expect(md).toContain('height="315"');
    expect(md).toContain('caption="Talk transcript"');
    expect(md).toContain('size="wide"');
  });

  test('detects vimeo provider from player.vimeo.com', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <iframe src="https://player.vimeo.com/video/76979871" width="640" height="360"></iframe>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('provider="vimeo"');
    expect(md).toContain('url="https://player.vimeo.com/video/76979871"');
  });

  test('detects spotify provider from open.spotify.com', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <iframe src="https://open.spotify.com/embed/track/abc"></iframe>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('provider="spotify"');
  });

  test('converts twitter blockquote to embed shortcode with provider twitter', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <blockquote class="twitter-tweet">
          <p lang="en" dir="ltr">Hello world</p>
          &mdash; Jane (@jane)
          <a href="https://twitter.com/jane/status/123456789">May 1, 2024</a>
        </blockquote>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('provider="twitter"');
    expect(md).toContain('url="https://twitter.com/jane/status/123456789"');
  });

  test('converts instagram blockquote using data-instgrm-permalink', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/CXYZ/">
          <a href="https://www.instagram.com/p/CXYZ/">View on Instagram</a>
        </blockquote>
        <figcaption>A photo</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('provider="instagram"');
    expect(md).toContain('url="https://www.instagram.com/p/CXYZ/"');
    expect(md).toContain('caption="A photo"');
  });

  test('falls back to anchor href for non-iframe non-blockquote embed', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <a href="https://codepen.io/user/pen/abc">View on CodePen</a>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('url="https://codepen.io/user/pen/abc"');
    expect(md).toContain('provider="codepen"');
  });

  test('omits provider attribute when host is unrecognised', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <iframe src="https://example.invalid/embed/xyz"></iframe>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('url="https://example.invalid/embed/xyz"');
    expect(md).not.toContain('provider=');
  });
});

describe('Ghost Turndown rules — kg-code-card', () => {
  test('preserves language from code class, figcaption, and line-number class', () => {
    const html =
      '<figure class="kg-card kg-code-card kg-card-hascaption line-numbers"><pre><code class="language-javascript">const msg = "hi";\nconsole.log(msg);</code></pre><figcaption>Runnable example</figcaption></figure>';
    const md = td.turndown(html);
    expect(md).toContain('{{< code');
    expect(md).toContain('language="javascript"');
    expect(md).toContain('caption="Runnable example"');
    expect(md).toContain('line-number-class="line-numbers"');
    expect(md).toContain('```javascript\nconst msg = "hi";\nconsole.log(msg);\n```');
    expect(md).toContain('{{< /code >}}');
  });

  test('preserves language from pre class when code has no language class', () => {
    const html =
      '<figure class="kg-card kg-code-card"><pre class="language-ts"><code>const answer: number = 42;</code></pre></figure>';
    const md = td.turndown(html);
    expect(md.trim()).toBe('```ts\nconst answer: number = 42;\n```');
  });

  test('preserves language from data-language attributes', () => {
    const html =
      '<figure class="kg-card kg-code-card" data-language="ruby"><pre><code>puts "hi"</code></pre></figure>';
    const md = td.turndown(html);
    expect(md.trim()).toBe('```ruby\nputs "hi"\n```');
  });
});

describe('Ghost Turndown rules — kg-video-card', () => {
  test('preserves source, poster, and caption', () => {
    const html = `
      <figure class="kg-card kg-video-card">
        <div class="kg-video-container">
          <video poster="/p.jpg" width="1280" height="720"><source src="/v.mp4" type="video/mp4" /></video>
        </div>
        <figcaption>Demo</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< video');
    expect(md).toContain('src="/v.mp4"');
    expect(md).toContain('poster="/p.jpg"');
    expect(md).toContain('width="1280"');
    expect(md).toContain('caption="Demo"');
  });

  // Regression for backlog task #99: the kg-video-card carries three distinct
  // asset references (poster image, video file, caption track) that live in
  // three different content subdirs. The default turndown walk dropped the
  // <track> child, orphaning the .vtt on disk after import.
  test('preserves caption <track> elements as nested video-track shortcodes', () => {
    const html = `
      <figure class="kg-card kg-video-card">
        <div class="kg-video-container">
          <video poster="/content/images/2024/01/poster.jpg" width="1280" height="720">
            <source src="/content/media/2024/01/demo.mp4" type="video/mp4" />
            <track src="/content/files/2024/01/demo-en.vtt" kind="subtitles" srclang="en" label="English" default />
            <track src="/content/files/2024/01/demo-es.vtt" kind="subtitles" srclang="es" label="Spanish" />
          </video>
        </div>
        <figcaption>Demo</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< video');
    expect(md).toContain('src="/content/media/2024/01/demo.mp4"');
    expect(md).toContain('poster="/content/images/2024/01/poster.jpg"');
    expect(md).toContain('{{< video-track src="/content/files/2024/01/demo-en.vtt"');
    expect(md).toContain('kind="subtitles"');
    expect(md).toContain('srclang="en"');
    expect(md).toContain('label="English"');
    expect(md).toContain('default="true"');
    expect(md).toContain('{{< video-track src="/content/files/2024/01/demo-es.vtt"');
    expect(md).toContain('{{< /video >}}');
  });

  // Regression for backlog task #100: Ghost's video card stores layout and
  // playback metadata outside the <video> element itself — the intrinsic
  // aspect ratio lives as a `--aspect-ratio` CSS custom prop on the
  // .kg-video-container wrapper, and loop/playsinline/preload are video
  // attrs the default turndown walk discards. Without these the rendered
  // player either reflows on load or loses the auto-playing UX Ghost ships.
  test('preserves --aspect-ratio CSS custom prop and loop/preload/playsinline attrs', () => {
    const html = `
      <figure class="kg-card kg-video-card kg-width-regular">
        <div class="kg-video-container" style="--aspect-ratio: 1.777">
          <video src="/content/media/2024/01/demo.mp4" poster="/content/images/2024/01/poster.jpg" preload="metadata" loop playsinline></video>
        </div>
        <figcaption>Demo</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< video');
    expect(md).toContain('src="/content/media/2024/01/demo.mp4"');
    expect(md).toContain('poster="/content/images/2024/01/poster.jpg"');
    expect(md).toContain('aspect="1.777"');
    expect(md).toContain('loop="true"');
    expect(md).toContain('playsinline="true"');
    expect(md).toContain('preload="metadata"');
    expect(md).toContain('caption="Demo"');
    expect(md).toContain('size="regular"');
  });

  // Aspect/loop/playsinline must NOT appear when their source attributes are
  // absent — formatAttrs already filters empty strings, but a bug in the
  // matcher (e.g. capturing the literal "0") would slip through silently.
  test('omits aspect/loop/playsinline when not present on source HTML', () => {
    const html = `
      <figure class="kg-card kg-video-card">
        <div class="kg-video-container">
          <video src="/v.mp4"></video>
        </div>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< video');
    expect(md).toContain('src="/v.mp4"');
    expect(md).not.toContain('aspect=');
    expect(md).not.toContain('loop=');
    expect(md).not.toContain('playsinline=');
    expect(md).not.toContain('preload=');
  });
});

describe('Ghost Turndown rules — kg-audio-card', () => {
  test('preserves source, title, duration, thumbnail', () => {
    const html = `
      <div class="kg-card kg-audio-card">
        <img src="/cover.jpg" alt="" class="kg-audio-thumbnail" />
        <div class="kg-audio-player-container">
          <audio src="/podcast.mp3"></audio>
          <div class="kg-audio-title">Episode 1</div>
          <div class="kg-audio-player">
            <span class="kg-audio-duration">12:34</span>
          </div>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< audio');
    expect(md).toContain('src="/podcast.mp3"');
    expect(md).toContain('title="Episode 1"');
    expect(md).toContain('duration="12:34"');
    expect(md).toContain('thumbnail="/cover.jpg"');
  });

  // Mirrors the full Koenig audio card shape Ghost actually emits — placeholder
  // SVG sibling div shares the `kg-audio-thumbnail` class, and the player
  // contains a `kg-audio-current-time` span that must NOT be mistaken for the
  // duration. Regression for the structure documented on backlog task #81.
  test('handles full Ghost output with placeholder div and current-time span', () => {
    const html = `
      <div class="kg-card kg-audio-card">
        <img class="kg-audio-thumbnail" src="/content/images/cover.jpg" alt="" />
        <div class="kg-audio-thumbnail kg-audio-hide kg-audio-thumbnail-placeholder">
          <svg><path d="M0 0"/></svg>
        </div>
        <div class="kg-audio-player-container">
          <audio src="/content/media/podcast.mp3" preload="metadata"></audio>
          <div class="kg-audio-title">Episode 5: Goldilocks</div>
          <div class="kg-audio-player">
            <button class="kg-audio-play-icon"></button>
            <span class="kg-audio-current-time">0:00</span>
            <span class="kg-audio-time-divider">/</span>
            <span class="kg-audio-duration">42:07</span>
            <input type="range" class="kg-audio-seek-slider" />
          </div>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< audio');
    expect(md).toContain('src="/content/media/podcast.mp3"');
    expect(md).toContain('title="Episode 5: Goldilocks"');
    expect(md).toContain('duration="42:07"');
    expect(md).not.toContain('duration="0:00"');
    expect(md).toContain('thumbnail="/content/images/cover.jpg"');
  });

  test('omits thumbnail when only the SVG placeholder is present', () => {
    const html = `
      <div class="kg-card kg-audio-card">
        <div class="kg-audio-thumbnail kg-audio-thumbnail-placeholder">
          <svg></svg>
        </div>
        <div class="kg-audio-player-container">
          <audio src="/no-cover.mp3"></audio>
          <div class="kg-audio-title">Cover-less</div>
          <div class="kg-audio-player">
            <span class="kg-audio-duration">5:00</span>
          </div>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('src="/no-cover.mp3"');
    expect(md).toContain('duration="5:00"');
    expect(md).not.toContain('thumbnail=');
  });

  test('falls back to <source> when <audio> has no src attribute', () => {
    const html = `
      <div class="kg-card kg-audio-card">
        <div class="kg-audio-player-container">
          <audio preload="metadata"><source src="/song.ogg" type="audio/ogg" /></audio>
          <div class="kg-audio-title">Source fallback</div>
          <div class="kg-audio-player">
            <span class="kg-audio-duration">3:14</span>
          </div>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('src="/song.ogg"');
    expect(md).toContain('title="Source fallback"');
    expect(md).toContain('duration="3:14"');
  });
});

describe('Ghost Turndown rules — kg-file-card', () => {
  test('preserves href, title, caption, filename, filesize', () => {
    const html = `
      <div class="kg-card kg-file-card ">
        <a class="kg-file-card-container" href="/content/files/spec.pdf" title="Download">
          <div class="kg-file-card-contents">
            <div class="kg-file-card-title">Spec</div>
            <div class="kg-file-card-caption">Latest draft</div>
            <div class="kg-file-card-metadata">
              <div class="kg-file-card-filename">spec.pdf</div>
              <div class="kg-file-card-filesize">2.4 MB</div>
            </div>
          </div>
        </a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< file');
    expect(md).toContain('href="/content/files/spec.pdf"');
    expect(md).toContain('title="Spec"');
    expect(md).toContain('description="Latest draft"');
    expect(md).toContain('name="spec.pdf"');
    expect(md).toContain('size="2.4 MB"');
    expect(md).not.toContain('[Spec](/content/files/spec.pdf)');
  });
});

describe('Ghost Turndown rules — kg-callout-card', () => {
  test('emits block shortcode with emoji, color, and inline content', () => {
    const html = `
      <div class="kg-card kg-callout-card kg-callout-card-blue">
        <div class="kg-callout-emoji">💡</div>
        <div class="kg-callout-text">This is a <strong>tip</strong>.</div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< callout');
    expect(md).toContain('emoji="💡"');
    expect(md).toContain('color="blue"');
    expect(md).toContain('This is a **tip**.');
    expect(md).toContain('{{< /callout >}}');
  });

  test('preserves iconless callout state', () => {
    const html = `
      <div class="kg-card kg-callout-card kg-callout-card-grey kg-callout-card-without-emoji">
        <div class="kg-callout-text">Note: be careful.</div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< callout');
    expect(md).toContain('no-icon="true"');
    expect(md).toContain('color="grey"');
    expect(md).not.toContain('emoji=""');
    expect(md).not.toContain('emoji-html=""');
    expect(md).toContain('Note: be careful.');
  });

  test('preserves custom callout emoji markup', () => {
    const html = `
      <div class="kg-card kg-callout-card kg-callout-card-pink">
        <div class="kg-callout-emoji"><img class="kg-callout-emoji-image" src="https://example.com/icon.png" alt="Custom"></div>
        <div class="kg-callout-text">Custom icon.</div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain(
      'emoji-html="<img class=\\"kg-callout-emoji-image\\" src=\\"https://example.com/icon.png\\" alt=\\"Custom\\">"',
    );
    expect(md).toContain('color="pink"');
    expect(md).not.toContain('no-icon="true"');
    expect(md).toContain('Custom icon.');
  });
});

describe('Ghost Turndown rules — kg-toggle-card', () => {
  test('preserves heading and converts inner content to markdown', () => {
    const html = `
      <div class="kg-card kg-toggle-card">
        <div class="kg-toggle-heading">
          <h4 class="kg-toggle-heading-text">Show details</h4>
        </div>
        <div class="kg-toggle-content"><p>Hidden paragraph.</p></div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< toggle heading="Show details" >}}');
    expect(md).toContain('Hidden paragraph.');
    expect(md).toContain('{{< /toggle >}}');
  });

  test('preserves width and open state as shortcode attributes', () => {
    const html = `
      <div class="kg-card kg-toggle-card kg-width-wide" data-kg-toggle-state="open">
        <div class="kg-toggle-heading">
          <h4 class="kg-toggle-heading-text">Advanced options</h4>
        </div>
        <div class="kg-toggle-content">
          <p>Use <strong>carefully</strong>.</p>
        </div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< toggle');
    expect(md).toContain('heading="Advanced options"');
    expect(md).toContain('width="wide"');
    expect(md).toContain('state="open"');
    expect(md).toContain('Use **carefully**.');
  });
});

describe('Ghost Turndown rules — kg-button-card', () => {
  test('preserves href, alignment, style, and label', () => {
    const html = `
      <div class="kg-card kg-button-card kg-align-center">
        <a href="https://example.com/buy" class="kg-btn kg-btn-accent">Buy now</a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{% button');
    expect(md).toContain('href="https://example.com/buy"');
    expect(md).toContain('text="Buy now"');
    expect(md).toContain('align="center"');
    expect(md).toContain('style="accent"');
    expect(md).toContain('%}');
    expect(md).not.toContain('[Buy now](https://example.com/buy)');
  });
});

describe('Ghost Turndown rules — kg-signup-card', () => {
  test('preserves copy, layout, and data-members form contract as a signup shortcode', () => {
    const html = `
      <div
        class="kg-card kg-signup-card kg-width-wide kg-style-image"
        data-kg-background-image="https://cdn.test/signup.jpg"
        style="background-image: url(https://cdn.test/signup.jpg)"
      >
        <h2 class="kg-signup-card-heading">Join the newsletter</h2>
        <p class="kg-signup-card-subheading">One short digest per week.</p>
        <form class="kg-signup-card-form" action="/members/api/send-magic-link/" method="post" data-members-form="signup">
          <label>
            Name
            <input class="kg-signup-card-input" type="text" name="name" placeholder="Your name" data-members-name required>
          </label>
          <label>
            Email
            <input class="kg-signup-card-input" type="email" name="email" placeholder="you@example.com" data-members-email required>
          </label>
          <input type="hidden" data-members-label value="weekly">
          <input type="hidden" data-members-label value="vip">
          <button class="kg-signup-card-button" type="submit">Subscribe</button>
          <p class="kg-signup-card-disclaimer">No spam. Unsubscribe anytime.</p>
          <p data-members-success>Check your inbox.</p>
          <p data-members-error>Please enter a valid email.</p>
        </form>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{% signup');
    expect(md).toContain('heading="Join the newsletter"');
    expect(md).toContain('subheading="One short digest per week."');
    expect(md).toContain('button="Subscribe"');
    expect(md).toContain('disclaimer="No spam. Unsubscribe anytime."');
    expect(md).toContain('background="https://cdn.test/signup.jpg"');
    expect(md).toContain('labels="weekly,vip"');
    expect(md).toContain('width="wide"');
    expect(md).toContain('style="image"');
    expect(md).toContain('form_action="/members/api/send-magic-link/"');
    expect(md).toContain('form_method="post"');
    expect(md).toContain('data-members-form="signup"');
    expect(md).toContain('name_field="name"');
    expect(md).toContain('name_placeholder="Your name"');
    expect(md).toContain('name_required="true"');
    expect(md).toContain('data-members-name="true"');
    expect(md).toContain('email_field="email"');
    expect(md).toContain('email_placeholder="you@example.com"');
    expect(md).toContain('email_required="true"');
    expect(md).toContain('data-members-email="true"');
    expect(md).toContain('success="Check your inbox."');
    expect(md).toContain('error="Please enter a valid email."');
    expect(md).toContain('%}');
    expect(md).not.toContain('## Join the newsletter');
    expect(md).not.toContain('Subscribe\n');
  });

  test('falls back to visible inputs when data-members markers are missing', () => {
    const html = `
      <div class="kg-card kg-signup-card kg-style-light">
        <h2 class="kg-signup-card-heading">Stay in the loop</h2>
        <form class="kg-signup-card-form" data-members-form="subscribe">
          <input class="kg-signup-card-input" type="text" name="full_name" placeholder="Full name">
          <input class="kg-signup-card-input" type="email" name="contact" placeholder="Email address">
          <button class="kg-signup-card-button">Join</button>
        </form>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{% signup');
    expect(md).toContain('heading="Stay in the loop"');
    expect(md).toContain('button="Join"');
    expect(md).toContain('data-members-form="subscribe"');
    expect(md).toContain('name_field="full_name"');
    expect(md).toContain('name_placeholder="Full name"');
    expect(md).toContain('email_field="contact"');
    expect(md).toContain('email_placeholder="Email address"');
  });
});

describe('Ghost Turndown rules — kg-header-card v1', () => {
  test('preserves style, background, title, subtitle, and CTA as a header shortcode', () => {
    const html = `
      <div class="kg-card kg-header-card kg-style-dark" data-kg-background-image="https://cdn.test/header.jpg" style="background-image: url(https://cdn.test/header.jpg)">
        <h2 class="kg-header-card-header">Launch notes</h2>
        <h3 class="kg-header-card-subheader">Everything that changed.</h3>
        <a href="https://example.com/start" class="kg-header-card-button">Get Started</a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{% header');
    expect(md).toContain('style="dark"');
    expect(md).toContain('background="https://cdn.test/header.jpg"');
    expect(md).toContain('title="Launch notes"');
    expect(md).toContain('subtitle="Everything that changed."');
    expect(md).toContain('cta-text="Get Started"');
    expect(md).toContain('cta-href="https://example.com/start"');
    expect(md).toContain('%}');
    expect(md).not.toContain('# Launch notes');
    expect(md).not.toContain('[Get Started](https://example.com/start)');
  });

  test('does not claim kg-v2 header cards', () => {
    const html = `
      <div class="kg-card kg-header-card kg-v2 kg-style-dark">
        <h2 class="kg-header-card-heading">Modern header</h2>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).not.toContain('{% header');
  });
});

describe('Ghost Turndown rules — kg-html-card', () => {
  test('preserves the inner HTML verbatim', () => {
    const html = `
      <div class="kg-card kg-html-card"><div class="hand-rolled">Hello <span style="color:red">world</span></div></div>
    `;
    const md = td.turndown(html);
    expect(md).toContain(
      '<div class="hand-rolled">Hello <span style="color:red">world</span></div>',
    );
    expect(md).not.toContain('kg-html-card');
  });
});

describe('Ghost Turndown rules — kg-product-card', () => {
  test('captures title, description, image, rating, and button', () => {
    const html = `
      <div class="kg-card kg-product-card">
        <img class="kg-product-card-image" src="/p.jpg" alt="" />
        <div class="kg-product-card-title">Widget</div>
        <div class="kg-product-card-description">Best in class.</div>
        <div class="kg-product-card-rating" data-rating="5"></div>
        <a class="kg-product-card-button" href="https://example.com/widget">Get it</a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< product');
    expect(md).toContain('title="Widget"');
    expect(md).toContain('description="Best in class."');
    expect(md).toContain('image="/p.jpg"');
    expect(md).toContain('rating="5"');
    expect(md).toContain('button-href="https://example.com/widget"');
    expect(md).toContain('button-text="Get it"');
  });
});

describe('Ghost Turndown rules — plain figure', () => {
  test('preserves caption from <figure><img><figcaption>', () => {
    const html = `
      <figure>
        <img src="/x.jpg" alt="X" />
        <figcaption>An X-rated caption</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('src="/x.jpg"');
    expect(md).toContain('alt="X"');
    expect(md).toContain('caption="An X-rated caption"');
  });

  test('falls back to plain markdown image when there is no caption', () => {
    const html = `<figure><img src="/x.jpg" alt="X" /></figure>`;
    const md = td.turndown(html);
    expect(md.trim()).toBe('![X](/x.jpg)');
  });
});

describe('Ghost Turndown rules — picture element', () => {
  test('falls back to the inner img', () => {
    const html = `
      <picture>
        <source srcset="/x.webp" type="image/webp" />
        <source srcset="/x.avif" type="image/avif" />
        <img src="/x.jpg" alt="Pic" />
      </picture>
    `;
    const md = td.turndown(html);
    expect(md.trim()).toContain('![Pic](/x.jpg)');
  });

  test('drops picture with no fallback img', () => {
    const html = `
      <picture><source srcset="/x.webp" type="image/webp" /></picture>
    `;
    const md = td.turndown(html).trim();
    expect(md).toBe('');
  });
});

describe('Ghost Turndown rules — kg-header-card fallback', () => {
  test('preserves v2 wrapper metadata as a header shortcode', () => {
    const html = `
      <div class="kg-card kg-header-card kg-v2 kg-style-dark kg-size-large" style="background-image: url(https://cdn.example.com/header.jpg)" data-background-image="https://cdn.example.com/header.jpg">
        <h2 class="kg-header-card-heading">Hero</h2>
        <h3 class="kg-header-card-subheading">Subheading</h3>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< header');
    expect(md).toContain('version="v2"');
    expect(md).toContain('style="dark"');
    expect(md).toContain('background_image="https://cdn.example.com/header.jpg"');
    expect(md).toContain('heading="Hero"');
    expect(md).toContain('subheading="Subheading"');
  });
});

describe('Ghost Turndown rules — inline semantic tags', () => {
  test('keeps mark, sub, sup, kbd, abbr, details, summary as HTML', () => {
    const html = `
      <p>Highlight <mark>this</mark> and <sub>1</sub><sup>2</sup>.</p>
      <p>Press <kbd>Ctrl</kbd> + <kbd>C</kbd>.</p>
      <p>The <abbr title="HyperText Markup Language">HTML</abbr> standard.</p>
      <details><summary>More info</summary><p>Hidden body.</p></details>
    `;
    const md = td.turndown(html);
    expect(md).toContain('<mark>this</mark>');
    expect(md).toContain('<sub>1</sub>');
    expect(md).toContain('<sup>2</sup>');
    expect(md).toContain('<kbd>Ctrl</kbd>');
    expect(md).toContain('<abbr title="HyperText Markup Language">HTML</abbr>');
    expect(md).toContain('<details>');
    expect(md).toContain('<summary>More info</summary>');
  });
});

describe('Ghost Turndown rules — attribute escaping', () => {
  test('escapes quotes inside attribute values', () => {
    const html = `
      <figure class="kg-card kg-bookmark-card">
        <a class="kg-bookmark-container" href="https://example.com/q?x=1">
          <div class="kg-bookmark-content">
            <div class="kg-bookmark-title">Quotes "and" backslashes \\\\ live here</div>
          </div>
        </a>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('title="Quotes \\"and\\" backslashes \\\\\\\\ live here"');
  });
});

describe('Ghost Turndown rules — regression: paragraphs and links untouched', () => {
  test('normal markdown content still converts as expected', () => {
    const html = '<p>Hello <a href="https://example.com">world</a></p>';
    const md = td.turndown(html);
    expect(md.trim()).toBe('Hello [world](https://example.com)');
  });
});

describe('preprocessKoenigCardFences', () => {
  test('wraps each card type in a data-kg-card div', () => {
    for (const type of ['markdown', 'html', 'email', 'email-cta']) {
      const input = `<!--kg-card-begin: ${type}--><p>Body</p><!--kg-card-end: ${type}-->`;
      expect(preprocessKoenigCardFences(input)).toBe(
        `<div data-kg-card="${type}"><p>Body</p></div>`,
      );
    }
  });

  test('handles multiple fences in one input', () => {
    const input =
      '<!--kg-card-begin: markdown--><p>A</p><!--kg-card-end: markdown-->\n' +
      '<p>between</p>\n' +
      '<!--kg-card-begin: html--><b>B</b><!--kg-card-end: html-->';
    const out = preprocessKoenigCardFences(input);
    expect(out).toContain('<div data-kg-card="markdown"><p>A</p></div>');
    expect(out).toContain('<div data-kg-card="html"><b>B</b></div>');
    expect(out).toContain('<p>between</p>');
  });

  test('tolerates whitespace around the card type', () => {
    const input = '<!-- kg-card-begin: markdown --><p>Hi</p><!-- kg-card-end: markdown -->';
    expect(preprocessKoenigCardFences(input)).toBe('<div data-kg-card="markdown"><p>Hi</p></div>');
  });

  test('leaves mismatched fences alone instead of swallowing content', () => {
    const input = '<!--kg-card-begin: markdown--><p>Hi</p><!--kg-card-end: html-->';
    expect(preprocessKoenigCardFences(input)).toBe(input);
  });

  test('leaves text without fences untouched', () => {
    const input = '<p>Just a paragraph.</p>';
    expect(preprocessKoenigCardFences(input)).toBe(input);
  });
});

describe('Ghost Turndown rules — members-only paywall marker', () => {
  test('preserves Ghost paywall comments as markdown split markers', () => {
    const html = preprocessKoenigCardFences(
      '<p>Public intro.</p><!--members-only--><p>Paid body.</p>',
    );
    const md = td.turndown(html);
    expect(md).toContain('Public intro.');
    expect(md).toContain('<!-- members-only -->');
    expect(md).toContain('Paid body.');
    expect(md.indexOf('Public intro.')).toBeLessThan(md.indexOf('<!-- members-only -->'));
    expect(md.indexOf('<!-- members-only -->')).toBeLessThan(md.indexOf('Paid body.'));
  });
});

describe('Ghost Turndown rules — email / email-cta cards (comment-fenced)', () => {
  test('strips email card content entirely', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: email--><p>Members only intro.</p><!--kg-card-end: email-->',
    );
    expect(td.turndown(html).trim()).toBe('');
  });

  test('strips email-cta card content entirely', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: email-cta--><p>Sign up!</p><!--kg-card-end: email-cta-->',
    );
    expect(td.turndown(html).trim()).toBe('');
  });

  test('strips email region without affecting surrounding public content', () => {
    const html = preprocessKoenigCardFences(
      '<p>Public.</p>\n' +
        '<!--kg-card-begin: email--><p>Members only.</p><!--kg-card-end: email-->\n' +
        '<p>Also public.</p>',
    );
    const md = td.turndown(html);
    expect(md).toContain('Public.');
    expect(md).toContain('Also public.');
    expect(md).not.toContain('Members only.');
  });
});

describe('Ghost Turndown rules — html card (comment-fenced)', () => {
  test('preserves inner HTML verbatim', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html--><div class="custom"><span style="color:red">x</span></div><!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).toContain('<div class="custom"><span style="color:red">x</span></div>');
  });

  test('drops empty html card', () => {
    const html = preprocessKoenigCardFences('<!--kg-card-begin: html--><!--kg-card-end: html-->');
    expect(td.turndown(html).trim()).toBe('');
  });

  test('strips <script> tags from comment-fenced html card', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html--><div>safe</div><script>alert(1)</script><!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).toContain('<div>safe</div>');
    expect(md).not.toContain('<script');
    expect(md).not.toContain('alert(1)');
  });

  test('strips inline event handlers from comment-fenced html card', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html--><button onclick="alert(1)">x</button><!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).not.toContain('onclick');
    expect(md).not.toContain('alert(1)');
  });

  test('drops javascript: URLs from anchors in html card', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html--><a href="javascript:alert(1)">x</a><!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).not.toContain('javascript:');
  });

  test('allows https iframes for custom embeds', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html--><iframe src="https://codepen.io/embed/abc" allowfullscreen></iframe><!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).toContain('<iframe');
    expect(md).toContain('src="https://codepen.io/embed/abc"');
  });

  test('drops http and javascript iframe sources', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html-->' +
        '<iframe src="http://insecure.example/widget"></iframe>' +
        '<iframe src="javascript:alert(1)"></iframe>' +
        '<!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).not.toContain('http://insecure.example/widget');
    expect(md).not.toContain('javascript:');
  });

  test('strips <style> block element but keeps inline style attribute', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: html-->' +
        '<style>body{display:none}</style>' +
        '<div style="color:red">visible</div>' +
        '<!--kg-card-end: html-->',
    );
    const md = td.turndown(html);
    expect(md).not.toContain('<style');
    expect(md).not.toContain('display:none');
    expect(md).toContain('style="color:red"');
    expect(md).toContain('visible');
  });
});

describe('Ghost Turndown rules — kg-html-card class-wrapped sanitisation', () => {
  test('strips <script> nested inside a kg-html-card div', () => {
    const html = '<div class="kg-card kg-html-card"><p>keep me</p><script>alert(1)</script></div>';
    const md = td.turndown(html);
    expect(md).toContain('<p>keep me</p>');
    expect(md).not.toContain('<script');
    expect(md).not.toContain('alert(1)');
  });
});

describe('sanitizeImportedHtmlCard', () => {
  test('keeps inline style attributes and safe markup', () => {
    const out = sanitizeImportedHtmlCard(
      '<div class="custom"><span style="color:red">x</span></div>',
    );
    expect(out).toBe('<div class="custom"><span style="color:red">x</span></div>');
  });

  test('strips all <script> regardless of attributes', () => {
    expect(sanitizeImportedHtmlCard('<script src="https://cdn.example/x.js"></script>')).toBe('');
    expect(sanitizeImportedHtmlCard('<script>alert(1)</script>')).toBe('');
  });

  test('keeps tables, lists, and figure structure', () => {
    const out = sanitizeImportedHtmlCard(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<th>h</th>');
    expect(out).toContain('<td>1</td>');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(sanitizeImportedHtmlCard('   \n  ')).toBe('');
  });
});

describe('Ghost Turndown rules — markdown card (comment-fenced)', () => {
  test('walks children and emits their markdown', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: markdown--><h2>Hello</h2><p>World</p><!--kg-card-end: markdown-->',
    );
    const md = td.turndown(html);
    expect(md).toContain('## Hello');
    expect(md).toContain('World');
  });

  test('inner kg-* card rules still fire from inside a markdown card', () => {
    const html = preprocessKoenigCardFences(
      '<!--kg-card-begin: markdown--><figure class="kg-card kg-image-card"><img src="/x.jpg" alt="x" /></figure><!--kg-card-end: markdown-->',
    );
    const md = td.turndown(html);
    expect(md).toContain('{{< figure');
    expect(md).toContain('src="/x.jpg"');
  });
});
