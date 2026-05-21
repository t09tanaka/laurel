import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '~/content/markdown.ts';

describe('Koenig card runtime/i18n markers', () => {
  test('marks default signup card labels for theme/runtime translation', async () => {
    const { html } = await renderMarkdown('{% signup heading="Join" %}');

    expect(html).toContain('class="kg-signup-card-button"');
    expect(html).toContain('data-kg-i18n="Subscribe"');
    expect(html).toContain('>Subscribe</button>');
  });

  test('keeps GIF image cards as images when no MP4 fallback is present', async () => {
    const { html } = await renderMarkdown(
      '{{< figure src="https://cdn.test/loop.gif" alt="Loop" width="640" height="360" />}}',
    );

    expect(html).toContain('class="kg-card kg-image-card');
    expect(html).toContain('src="https://cdn.test/loop.gif"');
    expect(html).not.toContain('<video');
  });

  test('renders GIF image cards as MP4 video when an explicit MP4 fallback is present', async () => {
    const { html } = await renderMarkdown(
      '{{< figure src="https://cdn.test/loop.gif" mp4="https://cdn.test/loop.mp4" alt="Loop" width="640" height="360" />}}',
    );

    expect(html).toContain('class="kg-card kg-video-card');
    expect(html).toContain('<video src="https://cdn.test/loop.mp4"');
    expect(html).toContain('poster="https://cdn.test/loop.gif"');
    expect(html).toContain('muted');
    expect(html).toContain('loop');
    expect(html).toContain('playsinline');
  });
});
