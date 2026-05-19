import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectImageDimensions, injectImageDimensionsIntoContent } from '~/build/images.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import type { ImageDimensions } from '~/util/image-size.ts';

function makeAssetsRoot(): string {
  return mkdtempSync(join(tmpdir(), 'nectar-img-inject-'));
}

function writeSvg(dir: string, name: string, width: number, height: number): string {
  const file = join(dir, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
    'utf8',
  );
  return file;
}

describe('injectImageDimensions', () => {
  test('injects width/height for a local image referenced by /content/images/', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 1200, 630);
    const html = '<p><img alt="cover" src="/content/images/cover.svg"></p>';
    const out = injectImageDimensions(html, { assetsRoot });
    expect(out).toBe(
      '<p><img alt="cover" src="/content/images/cover.svg" width="1200" height="630"></p>',
    );
  });

  test('skips remote URLs', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<img src="https://example.com/content/images/cover.svg">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('skips data URIs', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<img src="data:image/svg+xml;base64,PHN2Zy8+">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('skips protocol-relative URLs', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<img src="//cdn.example.com/x.png">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('preserves tags that already declare width or height', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 1200, 630);
    const widthOnly = '<img src="/content/images/cover.svg" width="200">';
    const heightOnly = '<img src="/content/images/cover.svg" height="100">';
    expect(injectImageDimensions(widthOnly, { assetsRoot })).toBe(widthOnly);
    expect(injectImageDimensions(heightOnly, { assetsRoot })).toBe(heightOnly);
  });

  test('leaves the tag untouched when the file does not exist', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<img src="/content/images/missing.svg">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('rejects path traversal escaping the assets root', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 1, 1);
    const html = '<img src="/content/images/../../etc/passwd">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('preserves self-closing form', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'a.svg', 10, 20);
    const html = '<img src="/content/images/a.svg" />';
    const out = injectImageDimensions(html, { assetsRoot });
    expect(out).toBe('<img src="/content/images/a.svg" width="10" height="20"/>');
  });

  test('handles multiple images and reuses cache per src', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'one.svg', 100, 50);
    writeSvg(assetsRoot, 'two.svg', 200, 75);
    const cache = new Map<string, ImageDimensions | null>();
    const html =
      '<img src="/content/images/one.svg">' +
      '<img src="/content/images/one.svg">' +
      '<img src="/content/images/two.svg">';
    const out = injectImageDimensions(html, { assetsRoot, cache });
    expect(out).toContain('src="/content/images/one.svg" width="100" height="50"');
    expect(out).toContain('src="/content/images/two.svg" width="200" height="75"');
    expect(cache.size).toBe(2);
  });

  test('caches negative lookups so missing files are probed once', () => {
    const assetsRoot = makeAssetsRoot();
    const cache = new Map<string, ImageDimensions | null>();
    writeSvg(assetsRoot, 'real.svg', 10, 10);
    // Force a probe miss by writing an unparseable file with a supported ext.
    const broken = join(assetsRoot, 'broken.png');
    writeFileSync(broken, 'not a real png');
    const html =
      '<img src="/content/images/broken.png">' + '<img src="/content/images/broken.png">';
    injectImageDimensions(html, { assetsRoot, cache });
    expect(cache.get(broken)).toBeNull();
  });

  test('ignores query strings and fragments when resolving src', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 800, 400);
    const html = '<img src="/content/images/cover.svg?v=2#anchor">';
    const out = injectImageDimensions(html, { assetsRoot });
    expect(out).toContain('width="800"');
    expect(out).toContain('height="400"');
  });

  test('preserves srcset and other attributes alongside injected dims', () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 1200, 630);
    const html =
      '<img alt="x" src="/content/images/cover.svg" srcset="/content/images/cover.svg 1200w" sizes="100vw" loading="lazy">';
    const out = injectImageDimensions(html, { assetsRoot });
    expect(out).toContain('srcset="/content/images/cover.svg 1200w"');
    expect(out).toContain('sizes="100vw"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('width="1200"');
    expect(out).toContain('height="630"');
  });

  test('skips when src is missing', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<img alt="empty">';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });

  test('skips when input has no <img> tags', () => {
    const assetsRoot = makeAssetsRoot();
    const html = '<p>no images here</p>';
    expect(injectImageDimensions(html, { assetsRoot })).toBe(html);
  });
});

describe('injectImageDimensionsIntoContent', () => {
  test('mutates post.html and page.html using the configured assets_dir', () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeSvg(join(cwd, assetsDir), 'cover.svg', 640, 360);
    const post = {
      id: 'post-x',
      slug: 'x',
      html: '<img src="/content/images/cover.svg">',
    } as unknown as Post;
    const page = {
      id: 'page-y',
      slug: 'y',
      html: '<img src="/content/images/cover.svg">',
    } as unknown as Page;
    const content: ContentGraph = {
      posts: [post],
      pages: [page],
      tags: [],
      authors: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      site: {} as ContentGraph['site'],
    };
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
    injectImageDimensionsIntoContent({ content, cwd, config });
    expect(post.html).toContain('width="640"');
    expect(post.html).toContain('height="360"');
    expect(page.html).toContain('width="640"');
    expect(page.html).toContain('height="360"');
  });
});
