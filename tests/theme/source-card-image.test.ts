import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';

const sourcePartialsDir = join(process.cwd(), 'example/themes/source/partials');

function renderCardImage(context: Record<string, unknown>): string {
  const hb = Handlebars.create();
  hb.registerHelper('img_url', (src: string, options: Handlebars.HelperOptions) => {
    const size = options.hash.size ? `-${options.hash.size}` : '';
    const format = options.hash.format ? `.${options.hash.format}` : '';
    return `${src}${size}${format}`;
  });
  hb.registerPartial('card-image', readFileSync(join(sourcePartialsDir, 'card-image.hbs'), 'utf8'));
  hb.registerPartial(
    'card-image-img',
    readFileSync(join(sourcePartialsDir, 'card-image-img.hbs'), 'utf8'),
  );

  return hb.compile('{{> "card-image"}}')(context);
}

describe('Source card-image partial', () => {
  test('renders captionless card images as a div', () => {
    const html = renderCardImage({
      feature_image: '/cover.jpg',
      feature_image_alt: 'Cover',
      feature_image_width: 1200,
      feature_image_height: 600,
      lazyLoad: true,
    });

    expect(html).toContain('<div class="gh-card-image">');
    expect(html).toContain('</div>');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<figcaption>');
    expect(html).toContain('loading="lazy" decoding="async"');
  });

  test('keeps figure semantics when a caption exists', () => {
    const html = renderCardImage({
      feature_image: '/cover.jpg',
      feature_image_alt: 'Cover',
      feature_image_caption: 'Photo by Casper.',
      feature_image_width: 1200,
      feature_image_height: 600,
      lazyLoad: false,
    });

    expect(html).toContain('<figure class="gh-card-image">');
    expect(html).toContain('<figcaption>Photo by Casper.</figcaption>');
    expect(html).toContain('</figure>');
    expect(html).not.toContain('<div class="gh-card-image">');
    expect(html).toContain('fetchpriority="high" decoding="async"');
  });
});
