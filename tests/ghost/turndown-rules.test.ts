import { describe, expect, test } from 'bun:test';
import { createGhostTurndown } from '~/ghost/turndown-rules.ts';

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
});

describe('Ghost Turndown rules — kg-gallery-card', () => {
  test('lists every gallery image with a stable shortcode wrapper', () => {
    const html = `
      <figure class="kg-card kg-gallery-card kg-width-wide">
        <div class="kg-gallery-container">
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/a.jpg" alt="A" /></div>
            <div class="kg-gallery-image"><img src="/img/b.jpg" alt="B" /></div>
          </div>
          <div class="kg-gallery-row">
            <div class="kg-gallery-image"><img src="/img/c.jpg" alt="C" /></div>
          </div>
        </div>
        <figcaption>Roll one</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< gallery caption="Roll one" >}}');
    expect(md).toContain('![A](/img/a.jpg)');
    expect(md).toContain('![B](/img/b.jpg)');
    expect(md).toContain('![C](/img/c.jpg)');
    expect(md).toContain('{{< /gallery >}}');
  });
});

describe('Ghost Turndown rules — kg-embed-card', () => {
  test('preserves iframe url, caption, and dimensions', () => {
    const html = `
      <figure class="kg-card kg-embed-card">
        <iframe src="https://www.youtube.com/embed/abc123" title="A talk" width="560" height="315"></iframe>
        <figcaption>Talk transcript</figcaption>
      </figure>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< embed');
    expect(md).toContain('url="https://www.youtube.com/embed/abc123"');
    expect(md).toContain('title="A talk"');
    expect(md).toContain('width="560"');
    expect(md).toContain('height="315"');
    expect(md).toContain('caption="Talk transcript"');
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
});

describe('Ghost Turndown rules — kg-file-card', () => {
  test('preserves href, title, caption, filename, filesize', () => {
    const html = `
      <div class="kg-card kg-file-card">
        <a class="kg-file-card-container" href="/content/files/spec.pdf">
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
    expect(md).toContain('src="/content/files/spec.pdf"');
    expect(md).toContain('title="Spec"');
    expect(md).toContain('caption="Latest draft"');
    expect(md).toContain('name="spec.pdf"');
    expect(md).toContain('size="2.4 MB"');
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

  test('handles callout without emoji', () => {
    const html = `
      <div class="kg-card kg-callout-card kg-callout-card-grey">
        <div class="kg-callout-text">Note: be careful.</div>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< callout color="grey" >}}');
    expect(md).not.toContain('emoji=""');
    expect(md).toContain('Note: be careful.');
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
});

describe('Ghost Turndown rules — kg-button-card', () => {
  test('preserves href, alignment, style, and label', () => {
    const html = `
      <div class="kg-card kg-button-card kg-align-center">
        <a href="https://example.com/buy" class="kg-btn kg-btn-accent">Buy now</a>
      </div>
    `;
    const md = td.turndown(html);
    expect(md).toContain('{{< button');
    expect(md).toContain('href="https://example.com/buy"');
    expect(md).toContain('align="center"');
    expect(md).toContain('style="accent"');
    expect(md).toContain('Buy now');
    expect(md).toContain('{{< /button >}}');
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
