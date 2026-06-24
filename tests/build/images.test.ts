import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_IMAGE_SIZES,
  DEFAULT_RESPONSIVE_WIDTHS,
  GALLERY_IMAGE_SIZES,
  type ImageVariantPlan,
  buildThemeImageSizeSegment,
  collapseDegenerateSrcset,
  collapseDegenerateSrcsetIntoContent,
  densifyImageSrcset,
  densifyWidths,
  generateImageVariants,
  generateThemeImageSizeVariants,
  injectImageDimensions,
  injectImageDimensionsIntoContent,
  injectImageLqip,
  injectImagePictureSources,
  injectImagePictureSourcesIntoContent,
  injectImageSrcset,
  injectImageSrcsetIntoContent,
  injectThemeImagePictureSources,
  planImageVariants,
} from '~/build/images.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import { readImageDimensions } from '~/util/image-size.ts';
import type { ImageDimensions } from '~/util/image-size.ts';

function makeAssetsRoot(): string {
  return mkdtempSync(join(tmpdir(), 'laurel-img-inject-'));
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

// readImageDimensions only inspects PNG signature + IHDR width/height (no CRC
// validation), so we can fabricate a 24-byte "PNG" that's enough to drive
// plan logic without depending on sharp or real image fixtures.
function writeFakePng(dir: string, name: string, width: number, height: number): string {
  const file = join(dir, name);
  mkdirSync(join(file, '..'), { recursive: true });
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdrLen = [0x00, 0x00, 0x00, 0x0d];
  const ihdrType = [0x49, 0x48, 0x44, 0x52];
  const rest = [0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  writeFileSync(
    file,
    Buffer.from([...sig, ...ihdrLen, ...ihdrType, ...u32be(width), ...u32be(height), ...rest]),
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
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    injectImageDimensionsIntoContent({ content, cwd, config });
    expect(post.html).toContain('width="640"');
    expect(post.html).toContain('height="360"');
    expect(page.html).toContain('width="640"');
    expect(page.html).toContain('height="360"');
  });

  test('adds lazy loading and async decoding hints without overriding explicit priority', () => {
    const cwd = makeAssetsRoot();
    const post = {
      id: 'post-x',
      slug: 'x',
      html: [
        '<img src="https://cdn.test/body.jpg" alt="Body">',
        '<img src="https://cdn.test/priority.jpg" alt="Priority" loading="eager" fetchpriority="high">',
        '<img src="https://cdn.test/custom.jpg" alt="Custom" loading="eager" decoding="sync">',
      ].join(''),
    } as unknown as Post;
    const content: ContentGraph = {
      posts: [post],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    const config = { content: { assets_dir: 'content/images' } } as unknown as LaurelConfig;

    injectImageDimensionsIntoContent({ content, cwd, config });

    expect(post.html).toContain(
      '<img src="https://cdn.test/body.jpg" alt="Body" loading="lazy" decoding="async">',
    );
    expect(post.html).toContain(
      '<img src="https://cdn.test/priority.jpg" alt="Priority" loading="eager" fetchpriority="high" decoding="async">',
    );
    expect(post.html).toContain(
      '<img src="https://cdn.test/custom.jpg" alt="Custom" loading="eager" decoding="sync">',
    );
  });
});

describe('planImageVariants', () => {
  test('emits widths smaller than the source for every raster under assets_dir', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeFakePng(join(cwd, assetsDir), 'wide.png', 2400, 1200);
    writeFakePng(join(cwd, assetsDir), 'mid.png', 1200, 800);
    writeFakePng(join(cwd, assetsDir), 'narrow.png', 500, 500);
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.get('wide.png')).toEqual([600, 1000, 1600]);
    expect(plan.get('mid.png')).toEqual([600, 1000]);
    // narrow.png is smaller than the smallest variant width → no entry.
    expect(plan.has('narrow.png')).toBe(false);
  });

  test('skips files under an existing size/wXXX/ subtree', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeFakePng(join(cwd, assetsDir), 'cover.png', 1200, 800);
    writeFakePng(join(cwd, assetsDir, 'size/w600'), 'cover.png', 600, 400);
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.has('cover.png')).toBe(true);
    expect(plan.has('size/w600/cover.png')).toBe(false);
  });

  test('skips SVG and other non-raster formats', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeSvg(join(cwd, assetsDir), 'cover.svg', 1200, 800);
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.size).toBe(0);
  });

  test('honours a custom widths list', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeFakePng(join(cwd, assetsDir), 'cover.png', 1000, 700);
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    const plan = await planImageVariants({ cwd, config, widths: [320, 640, 960, 1280] });
    expect(plan.get('cover.png')).toEqual([320, 640, 960]);
  });

  test('returns an empty plan when assets_dir does not exist', async () => {
    const cwd = makeAssetsRoot();
    const config = { content: { assets_dir: 'no/such/dir' } } as unknown as LaurelConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.size).toBe(0);
  });
});

describe('injectImageSrcset', () => {
  function planFor(entries: Record<string, number[]>): ImageVariantPlan {
    return new Map(Object.entries(entries));
  }

  test('emits srcset and default sizes when the src is in the plan', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000, 1600] });
    const html = '<img alt="x" src="/content/images/cover.jpg">';
    const out = injectImageSrcset(html, { plan });
    expect(out).toContain(
      'srcset="/content/images/size/w600/cover.jpg 600w, /content/images/size/w1000/cover.jpg 1000w, /content/images/size/w1600/cover.jpg 1600w"',
    );
    expect(out).toContain(`sizes="${DEFAULT_IMAGE_SIZES}"`);
  });

  test('leaves img untouched when src is not in the plan', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="/content/images/other.jpg">';
    expect(injectImageSrcset(html, { plan })).toBe(html);
  });

  test('does not overwrite an existing srcset', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="/content/images/cover.jpg" srcset="/content/images/cover.jpg 2x">';
    expect(injectImageSrcset(html, { plan })).toBe(html);
  });

  test('preserves an existing sizes attribute', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="/content/images/cover.jpg" sizes="100vw">';
    const out = injectImageSrcset(html, { plan });
    expect(out).toContain('sizes="100vw"');
    expect(out).not.toContain(DEFAULT_IMAGE_SIZES);
  });

  test('skips images already pointing at a variant URL', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="/content/images/size/w600/cover.jpg">';
    expect(injectImageSrcset(html, { plan })).toBe(html);
  });

  test('skips remote URLs', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="https://cdn.example.com/content/images/cover.jpg">';
    // No `/content/images/` marker match because the cdn host comes first.
    // We deliberately only rewrite locally-served paths.
    const out = injectImageSrcset(html, { plan });
    // The marker substring DOES appear in the URL, so the function will try to
    // resolve it. The plan key matches, so srcset is injected — but URLs use
    // the absolute prefix. This documents the current behaviour: any path
    // containing `/content/images/` is treated as a Ghost-style asset URL.
    expect(out).toContain(
      'srcset="https://cdn.example.com/content/images/size/w600/cover.jpg 600w, https://cdn.example.com/content/images/size/w1000/cover.jpg 1000w"',
    );
  });

  test('honours query strings on src when matching the plan', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg?v=2">';
    const out = injectImageSrcset(html, { plan });
    // The original src is preserved as-is on the tag; srcset uses the canonical
    // (de-queried) path because that's what Ghost emits and what's actually on
    // disk under size/.
    expect(out).toContain('src="/content/images/cover.jpg?v=2"');
    expect(out).toContain('srcset="/content/images/size/w600/cover.jpg 600w"');
  });

  test('rejects path traversal in src', () => {
    const plan = planFor({ '../etc/passwd': [600] });
    const html = '<img src="/content/images/../etc/passwd">';
    expect(injectImageSrcset(html, { plan })).toBe(html);
  });

  test('respects a custom sizesAttr override', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg">';
    const out = injectImageSrcset(html, { plan, sizesAttr: '50vw' });
    expect(out).toContain('sizes="50vw"');
  });

  test('uses the gallery sizes contract for in-gallery images', () => {
    const plan = planFor({ 'gallery/one.jpg': [600, 1000] });
    const html =
      '<figure class="kg-card kg-gallery-card"><div class="kg-gallery-image"><img src="/content/images/gallery/one.jpg" alt="One"></div></figure>';
    const out = injectImageSrcset(html, { plan });
    expect(out).toContain(
      'srcset="/content/images/size/w600/gallery/one.jpg 600w, /content/images/size/w1000/gallery/one.jpg 1000w"',
    );
    expect(out).toContain(`sizes="${GALLERY_IMAGE_SIZES}"`);
    expect(out).not.toContain(`sizes="${DEFAULT_IMAGE_SIZES}"`);
  });

  test('adds missing gallery sizes when a gallery image already has srcset', () => {
    const plan = planFor({ 'gallery/one.jpg': [600] });
    const html =
      '<div class="kg-gallery-image"><img src="/content/images/gallery/one.jpg" srcset="/content/images/size/w600/gallery/one.jpg 600w" alt="One"></div>';
    const out = injectImageSrcset(html, { plan });
    expect(out).toContain('srcset="/content/images/size/w600/gallery/one.jpg 600w"');
    expect(out).toContain(`sizes="${GALLERY_IMAGE_SIZES}"`);
  });

  test('preserves explicit gallery sizes when present', () => {
    const plan = planFor({ 'gallery/one.jpg': [600] });
    const html =
      '<div class="kg-gallery-image"><img src="/content/images/gallery/one.jpg" srcset="/content/images/size/w600/gallery/one.jpg 600w" sizes="50vw" alt="One"></div>';
    const out = injectImageSrcset(html, { plan });
    expect(out).toContain('sizes="50vw"');
    expect(out).not.toContain(GALLERY_IMAGE_SIZES);
  });

  test('returns input unchanged when the plan is empty', () => {
    const html = '<img src="/content/images/cover.jpg">';
    expect(injectImageSrcset(html, { plan: new Map() })).toBe(html);
  });

  test('preserves self-closing form', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg" />';
    const out = injectImageSrcset(html, { plan });
    expect(out).toMatch(/<img[^>]*srcset="[^"]+"[^>]*\/>/);
  });
});

describe('injectImageSrcsetIntoContent', () => {
  test('rewrites post.html, post.feed_html, and page.html using the plan', () => {
    const plan: ImageVariantPlan = new Map([['cover.jpg', [600, 1000]]]);
    const post = {
      id: 'p',
      slug: 'p',
      html: '<img src="/content/images/cover.jpg">',
      feed_html: '<img src="/content/images/cover.jpg" alt="feed">',
    } as unknown as Post;
    const page = {
      id: 'g',
      slug: 'g',
      html: '<img src="/content/images/cover.jpg">',
    } as unknown as Page;
    const content: ContentGraph = {
      posts: [post],
      pages: [page],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    injectImageSrcsetIntoContent({ content, plan });
    expect(post.html).toContain('size/w600/cover.jpg 600w');
    expect(post.feed_html).toContain('size/w1000/cover.jpg 1000w');
    expect(page.html).toContain('size/w600/cover.jpg 600w');
  });

  test('no-op when the plan is empty', () => {
    const post = {
      id: 'p',
      slug: 'p',
      html: '<img src="/content/images/cover.jpg">',
    } as unknown as Post;
    const content: ContentGraph = {
      posts: [post],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    injectImageSrcsetIntoContent({ content, plan: new Map() });
    expect(post.html).toBe('<img src="/content/images/cover.jpg">');
  });
});

describe('DEFAULT_RESPONSIVE_WIDTHS', () => {
  test("matches Ghost's contract (600/1000/1600/2400)", () => {
    expect(DEFAULT_RESPONSIVE_WIDTHS).toEqual([600, 1000, 1600, 2400]);
  });
});

describe('injectImagePictureSources', () => {
  function planFor(entries: Record<string, number[]>): ImageVariantPlan {
    return new Map(Object.entries(entries));
  }

  test('wraps <img> in <picture> with per-format <source> tags', () => {
    const plan = planFor({ 'cover.jpg': [600, 1000] });
    const html = '<img src="/content/images/cover.jpg">';
    const out = injectImagePictureSources(html, { plan, formats: ['avif', 'webp'] });
    expect(out).toContain('<picture>');
    expect(out).toContain(
      '<source type="image/avif" srcset="/content/images/size/w600/cover.jpg.avif 600w, /content/images/size/w1000/cover.jpg.avif 1000w"',
    );
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w600/cover.jpg.webp 600w, /content/images/size/w1000/cover.jpg.webp 1000w"',
    );
    expect(out).toContain('<img src="/content/images/cover.jpg">');
    expect(out).toContain('</picture>');
    // AVIF must appear before WebP so browsers pick the best supported.
    const avifIdx = out.indexOf('image/avif');
    const webpIdx = out.indexOf('image/webp');
    expect(avifIdx).toBeGreaterThan(-1);
    expect(webpIdx).toBeGreaterThan(avifIdx);
  });

  test('uses the default sizes attr when none is set on the img', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg">';
    const out = injectImagePictureSources(html, { plan, formats: ['webp'] });
    expect(out).toContain(`sizes="${DEFAULT_IMAGE_SIZES}"`);
  });

  test('propagates an existing sizes attribute to the <source> tags', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg" sizes="100vw">';
    const out = injectImagePictureSources(html, { plan, formats: ['webp'] });
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w600/cover.jpg.webp 600w" sizes="100vw">',
    );
  });

  test('skips when no formats are configured', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/cover.jpg">';
    expect(injectImagePictureSources(html, { plan, formats: [] })).toBe(html);
  });

  test('skips when the plan is empty', () => {
    const html = '<img src="/content/images/cover.jpg">';
    expect(injectImagePictureSources(html, { plan: new Map(), formats: ['webp'] })).toBe(html);
  });

  test('leaves untouched <img> tags that are already inside a <picture>', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html =
      '<picture><source type="image/avif" srcset="/x.avif"><img src="/content/images/cover.jpg"></picture>';
    expect(injectImagePictureSources(html, { plan, formats: ['webp'] })).toBe(html);
  });

  test('leaves <img> alone when src is not in the plan', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/other.jpg">';
    expect(injectImagePictureSources(html, { plan, formats: ['webp'] })).toBe(html);
  });

  test('skips images already pointing at a variant URL', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="/content/images/size/w600/cover.jpg">';
    expect(injectImagePictureSources(html, { plan, formats: ['webp'] })).toBe(html);
  });

  test('skips remote URLs (no marker substring)', () => {
    const plan = planFor({ 'cover.jpg': [600] });
    const html = '<img src="https://example.com/cover.jpg">';
    expect(injectImagePictureSources(html, { plan, formats: ['webp'] })).toBe(html);
  });

  test('rejects path traversal in src', () => {
    const plan = planFor({ '../etc/passwd': [600] });
    const html = '<img src="/content/images/../etc/passwd">';
    expect(injectImagePictureSources(html, { plan, formats: ['webp'] })).toBe(html);
  });

  test('handles multiple <img> tags with mixed plan membership', () => {
    const plan = planFor({ 'in.jpg': [600] });
    const html =
      '<img src="/content/images/in.jpg"><img src="/content/images/out.jpg"><img src="/content/images/in.jpg">';
    const out = injectImagePictureSources(html, { plan, formats: ['webp'] });
    // Two of the three become <picture>-wrapped; the middle one stays bare.
    expect((out.match(/<picture>/g) ?? []).length).toBe(2);
    expect(out).toContain('<img src="/content/images/out.jpg">');
  });

  test('skips sources that are not jpg/png even when present in the plan', () => {
    // Task #481: format variants only fire for jpg/png sources. webp/gif/svg
    // sources stay as bare <img>: re-encoding webp to webp would be wasteful,
    // and gif/svg fall outside the format-variant contract entirely.
    const plan = planFor({
      'cover.webp': [600],
      'banner.gif': [800],
      'icon.svg': [400],
    });
    const html =
      '<img src="/content/images/cover.webp">' +
      '<img src="/content/images/banner.gif">' +
      '<img src="/content/images/icon.svg">';
    expect(injectImagePictureSources(html, { plan, formats: ['webp', 'avif'] })).toBe(html);
  });

  test('handles PNG sources like jpg sources', () => {
    const plan = planFor({ 'shot.png': [600, 1000] });
    const html = '<img src="/content/images/shot.png">';
    const out = injectImagePictureSources(html, { plan, formats: ['webp'] });
    expect(out).toContain('<picture>');
    expect(out).toContain('<source type="image/webp"');
    expect(out).toContain('/content/images/size/w600/shot.png.webp 600w');
  });
});

describe('injectThemeImagePictureSources', () => {
  // Mirrors Source's feature-image.hbs output (size variants, no format).
  const featureImg = [
    '<img',
    ' srcset="/content/images/size/w320/cover.jpg 320w, /content/images/size/w600/cover.jpg 600w"',
    ' sizes="(max-width: 1200px) 100vw, 1120px"',
    ' src="/content/images/size/w1200/cover.jpg"',
    ' alt="Cover" loading="eager" fetchpriority="high" decoding="async">',
  ].join('');

  test('wraps a theme feature_image <img> in a <picture> with per-format <source>s', () => {
    const out = injectThemeImagePictureSources(featureImg, { formats: ['webp'] });
    expect(out.startsWith('<picture>')).toBe(true);
    expect(out.endsWith('</picture>')).toBe(true);
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w320/format/webp/cover.jpg.webp 320w, /content/images/size/w600/format/webp/cover.jpg.webp 600w" sizes="(max-width: 1200px) 100vw, 1120px">',
    );
    // The original <img> is preserved as the fallback.
    expect(out).toContain('src="/content/images/size/w1200/cover.jpg"');
    expect(out).toContain('fetchpriority="high"');
  });

  test('emits one <source> per format in config order (avif before webp)', () => {
    const out = injectThemeImagePictureSources(featureImg, { formats: ['avif', 'webp'] });
    const avifIdx = out.indexOf('image/avif');
    const webpIdx = out.indexOf('image/webp');
    expect(avifIdx).toBeGreaterThan(-1);
    expect(webpIdx).toBeGreaterThan(avifIdx);
    expect(out).toContain('/content/images/size/w320/format/avif/cover.jpg.avif 320w');
  });

  test('skips when no formats are configured', () => {
    expect(injectThemeImagePictureSources(featureImg, { formats: [] })).toBe(featureImg);
  });

  test('leaves Source post-card srcsets (already format/webp) untouched', () => {
    // card-image-img.hbs already passes format="webp", so the srcset entries
    // already live under /format/webp/ — there is nothing to upgrade.
    const card =
      '<img srcset="/content/images/size/w160/format/webp/cover.jpg.webp 160w" ' +
      'src="/content/images/size/w600/cover.jpg" loading="lazy">';
    expect(injectThemeImagePictureSources(card, { formats: ['webp'] })).toBe(card);
  });

  test('leaves <img> already inside a <picture> untouched', () => {
    const html = `<picture><source type="image/webp" srcset="/x.webp">${featureImg}</picture>`;
    expect(injectThemeImagePictureSources(html, { formats: ['webp'] })).toBe(html);
  });

  test('skips images without a size segment', () => {
    const html = '<img src="/content/images/cover.jpg" fetchpriority="high">';
    expect(injectThemeImagePictureSources(html, { formats: ['webp'] })).toBe(html);
  });

  test('skips svg / non-jpg-png sources', () => {
    const svg = '<img src="/content/images/size/w600/logo.svg">';
    const webp = '<img src="/content/images/size/w600/cover.webp">';
    expect(injectThemeImagePictureSources(svg, { formats: ['webp'] })).toBe(svg);
    expect(injectThemeImagePictureSources(webp, { formats: ['webp'] })).toBe(webp);
  });

  test('drops non-transformable srcset entries (remote/original) from the <source>', () => {
    const html =
      '<img srcset="/content/images/size/w320/cover.jpg 320w, https://cdn.example.com/x.jpg 600w">';
    const out = injectThemeImagePictureSources(html, { formats: ['webp'] });
    // The remote entry is dropped from the WebP <source>; the <img> keeps it.
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w320/format/webp/cover.jpg.webp 320w">',
    );
    expect(out).toContain('https://cdn.example.com/x.jpg 600w');
  });

  test('keeps the full-res original in the <source> via its per-format twin', () => {
    // Real-world LCP case: when a requested size would not shrink the source,
    // {{img_url}} emits the full-resolution original (no `size/` segment), so the
    // largest srcset entry is the bare original. generateThemeImageSizeVariants
    // materialises a `format/<fmt>/<rel>` twin of that original, so the WebP
    // <source> mirrors the <img> fallback's largest width instead of capping at
    // the size buckets (otherwise WebP tops out below the JPEG fallback).
    const html = [
      '<img srcset="/content/images/size/w320/cover.jpg 320w, ',
      '/content/images/size/w600/cover.jpg 600w, ',
      '/content/images/cover.jpg 2000w" ',
      'src="/content/images/cover.jpg" fetchpriority="high">',
    ].join('');
    const out = injectThemeImagePictureSources(html, { formats: ['webp'] });
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w320/format/webp/cover.jpg.webp 320w, /content/images/size/w600/format/webp/cover.jpg.webp 600w, /content/images/format/webp/cover.jpg.webp 2000w">',
    );
    // The JPEG fallback still keeps the bare original.
    expect(out).toContain('/content/images/cover.jpg 2000w');
  });

  test('maps the original tail for avif and webp', () => {
    const html = [
      '<img srcset="/content/images/size/w600/cover.jpg 600w, ',
      '/content/images/cover.jpg 2000w" src="/content/images/cover.jpg">',
    ].join('');
    const out = injectThemeImagePictureSources(html, { formats: ['avif', 'webp'] });
    expect(out).toContain('/content/images/format/avif/cover.jpg.avif 2000w');
    expect(out).toContain('/content/images/format/webp/cover.jpg.webp 2000w');
  });

  test('does not map a lone bare original without a sized sibling', () => {
    // No sized entry proves the source participates in theme sizing, so the
    // full-res twin is not guaranteed on disk; leave the tag untouched rather
    // than risk a 404 <source>.
    const html = '<img srcset="/content/images/cover.jpg 2000w" src="/content/images/cover.jpg">';
    expect(injectThemeImagePictureSources(html, { formats: ['webp'] })).toBe(html);
  });

  test('does not map a bare original from a different source than the sized sibling', () => {
    // A sized sibling for `logo.jpg` does not prove `different.jpg` has a
    // materialised twin; mapping it could 404 a hand-authored mixed-source
    // srcset, so the foreign original is dropped from the <source>.
    const html = [
      '<img srcset="/content/images/size/w600/logo.jpg 600w, ',
      '/content/images/different.jpg 2000w" src="/content/images/logo.jpg">',
    ].join('');
    const out = injectThemeImagePictureSources(html, { formats: ['webp'] });
    expect(out).toContain('/content/images/size/w600/format/webp/logo.jpg.webp 600w');
    expect(out).not.toContain('format/webp/different.jpg.webp');
    // The foreign original is still kept on the <img> fallback.
    expect(out).toContain('/content/images/different.jpg 2000w');
  });

  test('does not map a bare original src without a width descriptor', () => {
    // A lone `<img src>` original has no descriptor and no guaranteed twin.
    const html = '<img src="/content/images/cover.jpg">';
    expect(injectThemeImagePictureSources(html, { formats: ['webp'] })).toBe(html);
  });

  test('is idempotent (re-running does not double-wrap)', () => {
    const once = injectThemeImagePictureSources(featureImg, { formats: ['webp'] });
    const twice = injectThemeImagePictureSources(once, { formats: ['webp'] });
    expect(twice).toBe(once);
  });

  test('falls back to src when the <img> has no srcset', () => {
    const html = '<img src="/content/images/size/w600/cover.jpg" fetchpriority="high">';
    const out = injectThemeImagePictureSources(html, { formats: ['webp'] });
    expect(out).toContain(
      '<source type="image/webp" srcset="/content/images/size/w600/format/webp/cover.jpg.webp">',
    );
  });
});

describe('injectImagePictureSourcesIntoContent', () => {
  test('wraps post.html, post.feed_html, and page.html using the plan and formats', () => {
    const plan: ImageVariantPlan = new Map([['cover.jpg', [600, 1000]]]);
    const post = {
      id: 'p',
      slug: 'p',
      html: '<img src="/content/images/cover.jpg">',
      feed_html: '<img src="/content/images/cover.jpg" alt="feed">',
    } as unknown as Post;
    const page = {
      id: 'g',
      slug: 'g',
      html: '<img src="/content/images/cover.jpg">',
    } as unknown as Page;
    const content: ContentGraph = {
      posts: [post],
      pages: [page],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    injectImagePictureSourcesIntoContent({ content, plan, formats: ['webp', 'avif'] });
    expect(post.html).toContain('<picture>');
    expect(post.html).toContain('image/webp');
    expect(post.html).toContain('image/avif');
    expect(post.feed_html).toContain('<picture>');
    expect(page.html).toContain('<picture>');
  });

  test('no-op when formats is empty', () => {
    const post = {
      id: 'p',
      slug: 'p',
      html: '<img src="/content/images/cover.jpg">',
    } as unknown as Post;
    const content: ContentGraph = {
      posts: [post],
      pages: [],
      tags: [],
      authors: [],
      tiers: [],
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
      emailOnlyPosts: [],
      site: {} as ContentGraph['site'],
    };
    injectImagePictureSourcesIntoContent({
      content,
      plan: new Map([['cover.jpg', [600]]]),
      formats: [],
    });
    expect(post.html).toBe('<img src="/content/images/cover.jpg">');
  });
});

describe('injectImageLqip', () => {
  test('inlines a tiny JPEG placeholder for local raster images', async () => {
    const assetsRoot = makeAssetsRoot();
    await writeRealPng(join(assetsRoot, 'cover.png'), 1200, 800);
    const html = '<img src="/content/images/cover.png" alt="Cover">';

    const out = await injectImageLqip(html, { assetsRoot });

    expect(out).toContain('src="/content/images/cover.png"');
    expect(out).toContain('style="background:url(data:image/jpeg;base64,');
    expect(out).toContain('center / cover no-repeat;"');
  });

  test('appends to existing style without replacing non-background rules', async () => {
    const assetsRoot = makeAssetsRoot();
    await writeRealPng(join(assetsRoot, 'cover.png'), 800, 600);
    const html = '<img src="/content/images/cover.png" style="object-fit:cover" alt="Cover">';

    const out = await injectImageLqip(html, { assetsRoot });

    expect(out).toContain('style="object-fit:cover;background:url(data:image/jpeg;base64,');
  });

  test('skips remote images, SVGs, and tags with an existing background', async () => {
    const assetsRoot = makeAssetsRoot();
    writeSvg(assetsRoot, 'cover.svg', 1200, 800);
    await writeRealPng(join(assetsRoot, 'cover.png'), 1200, 800);
    const html = [
      '<img src="https://example.com/cover.png">',
      '<img src="/content/images/cover.svg">',
      '<img src="/content/images/cover.png" style="background:#eee">',
    ].join('');

    const out = await injectImageLqip(html, { assetsRoot });

    expect(out).toBe(html);
  });
});

describe('buildThemeImageSizeSegment', () => {
  test('width only -> wN', () => {
    expect(buildThemeImageSizeSegment({ width: 600 })).toBe('w600');
  });

  test('height only -> hN', () => {
    expect(buildThemeImageSizeSegment({ height: 800 })).toBe('h800');
  });

  test('width + height -> wNhM', () => {
    expect(buildThemeImageSizeSegment({ width: 400, height: 400 })).toBe('w400h400');
  });

  test('empty/zero size yields empty segment', () => {
    expect(buildThemeImageSizeSegment({})).toBe('');
    expect(buildThemeImageSizeSegment({ width: 0 })).toBe('');
    expect(buildThemeImageSizeSegment({ height: 0 })).toBe('');
  });

  test('agrees with the URL helper for Source-theme sizes', () => {
    expect(buildThemeImageSizeSegment({ width: 160 })).toBe('w160');
    expect(buildThemeImageSizeSegment({ width: 320 })).toBe('w320');
    expect(buildThemeImageSizeSegment({ width: 600 })).toBe('w600');
    expect(buildThemeImageSizeSegment({ width: 960 })).toBe('w960');
    expect(buildThemeImageSizeSegment({ width: 1200 })).toBe('w1200');
    expect(buildThemeImageSizeSegment({ width: 2000 })).toBe('w2000');
  });
});

async function writeRealPng(file: string, width: number, height: number): Promise<void> {
  const sharp = (await import('sharp')).default;
  mkdirSync(join(file, '..'), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .png()
    .toFile(file);
}

async function writeRealJpegWithExif(file: string, width: number, height: number): Promise<void> {
  const sharp = (await import('sharp')).default;
  mkdirSync(join(file, '..'), { recursive: true });
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 80, g: 120, b: 160 },
    },
  })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'SECRET_GPS' } })
    .toFile(file);
}

async function hasExifMetadata(file: string): Promise<boolean> {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(file).metadata();
  return metadata.exif !== undefined;
}

describe('generateImageVariants metadata policy', () => {
  test('strips EXIF metadata from resized variants by default', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-image-exif-'));
    const assetsDir = 'content/images';
    await writeRealJpegWithExif(join(cwd, assetsDir, 'photo.jpg'), 80, 60);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateImageVariants({
      cwd,
      config,
      outputDir,
      plan: new Map([['photo.jpg', [40]]]),
    });

    expect(count).toBe(1);
    const out = join(outputDir, 'content/images/size/w40/photo.jpg');
    expect(existsSync(out)).toBe(true);
    expect(await hasExifMetadata(out)).toBe(false);
  });

  test('can preserve EXIF metadata when stripMetadata is disabled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-image-exif-'));
    const assetsDir = 'content/images';
    await writeRealJpegWithExif(join(cwd, assetsDir, 'photo.jpg'), 80, 60);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateImageVariants({
      cwd,
      config,
      outputDir,
      plan: new Map([['photo.jpg', [40]]]),
      stripMetadata: false,
    });

    expect(count).toBe(1);
    const out = join(outputDir, 'content/images/size/w40/photo.jpg');
    expect(existsSync(out)).toBe(true);
    expect(await hasExifMetadata(out)).toBe(true);
  });

  test('caches same-format responsive variants by source content hash', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-image-cache-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'article/hero.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const cacheDir = join(cwd, '.laurel/cache/images');
    const config = {
      content: { assets_dir: assetsDir },
      components: { images: { cache_dir: cacheDir, strip_metadata: true } },
    } as unknown as LaurelConfig;
    const plan = new Map([['article/hero.png', [600]]]);

    const firstCount = await generateImageVariants({ cwd, config, outputDir, plan });
    expect(firstCount).toBe(1);

    const cacheFiles = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true }),
    );
    expect(cacheFiles).toHaveLength(1);
    expect(cacheFiles[0]).toContain('w600');
    expect(existsSync(join(outputDir, 'content/images/size/w600/article/hero.png'))).toBe(true);

    await rm(outputDir, { recursive: true, force: true });
    const secondCount = await generateImageVariants({ cwd, config, outputDir, plan });

    expect(secondCount).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/article/hero.png'))).toBe(true);
    const cacheFilesAfter = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true }),
    );
    expect(cacheFilesAfter).toEqual(cacheFiles);
  });
});

describe('generateThemeImageSizeVariants', () => {
  test('materialises one file per (source, size) into <outputDir>/content/images/size/<segment>/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1600, 1000);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        xs: { width: 160 },
        s: { width: 320 },
        m: { width: 600 },
      },
    });

    expect(count).toBe(3);
    for (const w of [160, 320, 600]) {
      const p = join(outputDir, 'content/images/size', `w${w}`, 'cover.png');
      expect(existsSync(p)).toBe(true);
      const dims = readImageDimensions(p);
      expect(dims?.width).toBe(w);
    }
  });

  test('skips sizes that would upscale the source', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'small.png'), 400, 300);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        xs: { width: 160 },
        xl: { width: 1200 },
        xxl: { width: 2000 },
      },
    });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w160/small.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w1200/small.png'))).toBe(false);
    expect(existsSync(join(outputDir, 'content/images/size/w2000/small.png'))).toBe(false);
  });

  test('emits height-only and width+height segments mirroring the URL helper', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 1200);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        tall: { height: 600 },
        square: { width: 400, height: 400 },
      },
    });

    expect(count).toBe(2);
    expect(existsSync(join(outputDir, 'content/images/size/h600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w400h400/cover.png'))).toBe(true);
  });

  test('ignores nested assets/size/* sources so re-builds are idempotent', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    await writeRealPng(join(cwd, assetsDir, 'size/w600/cover.png'), 600, 400);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
    });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/size/w600/cover.png'))).toBe(false);
  });

  test('preserves subdirectory layout under size/<segment>/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, '2026/05/photo.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
    });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/2026/05/photo.png'))).toBe(true);
  });

  test('no-op when theme defines no image_sizes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {},
    });

    expect(count).toBe(0);
  });

  test('no-op when assets_dir does not exist', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const config = { content: { assets_dir: 'no/such/dir' } } as unknown as LaurelConfig;
    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir: join(cwd, 'dist'),
      themeImageSizes: { m: { width: 600 } },
    });
    expect(count).toBe(0);
  });

  test('emits per-format variants under size/<segment>/format/<ext>/ when formats are configured', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1600, 1000);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        xs: { width: 160 },
        m: { width: 600 },
      },
      cacheDir: join(cwd, '.laurel/cache/images'),
      formats: ['webp'],
    });

    // 2 base + 2 webp = 4 emitted files.
    expect(count).toBe(4);
    expect(existsSync(join(outputDir, 'content/images/size/w160/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w160/format/webp/cover.png.webp'))).toBe(
      true,
    );
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png.webp'))).toBe(
      true,
    );
  });

  test('emits a full-res per-format twin when a theme size does not shrink the source', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    // 400px source: xs(160) shrinks, m(600) does not -> img_url emits the bare
    // original for m, so the original needs a webp twin for the <source>.
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 400, 300);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        xs: { width: 160 },
        m: { width: 600 },
      },
      cacheDir: join(cwd, '.laurel/cache/images'),
      formats: ['webp'],
    });

    // 1 base (w160) + 1 webp (w160) + 1 full-res webp twin = 3.
    expect(count).toBe(3);
    expect(existsSync(join(outputDir, 'content/images/size/w160/format/webp/cover.png.webp'))).toBe(
      true,
    );
    expect(existsSync(join(outputDir, 'content/images/format/webp/cover.png.webp'))).toBe(true);
    // m(600) does not shrink the 400px source, so no upscaled size variant.
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(false);
  });

  test('does not emit a full-res twin when every theme size shrinks the source', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { xs: { width: 160 }, m: { width: 600 } },
      cacheDir: join(cwd, '.laurel/cache/images'),
      formats: ['webp'],
    });

    expect(existsSync(join(outputDir, 'content/images/format/webp/cover.png.webp'))).toBe(false);
  });

  test('skips format variants for non-jpg/png sources', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    // sharp can read webp, but emitting `cover.webp` re-encoded as webp is busy
    // work; the existing same-format src is already webp.
    const sharp = (await import('sharp')).default;
    mkdirSync(join(cwd, assetsDir), { recursive: true });
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .webp()
      .toFile(join(cwd, assetsDir, 'cover.webp'));
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
      cacheDir: join(cwd, '.laurel/cache/images'),
      formats: ['webp'],
    });

    // Only the base variant — no `format/webp/` re-encode for a webp source.
    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.webp'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.webp'))).toBe(
      false,
    );
  });

  test('does not emit format variants when cacheDir is not provided', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
      formats: ['webp'],
    });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png.webp'))).toBe(
      false,
    );
  });

  test('caches encoded bytes by content hash so a rebuild reuses them', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const cacheDir = join(cwd, '.laurel/cache/images');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;
    const themeImageSizes = { m: { width: 600 } };

    await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes,
      cacheDir,
      formats: ['webp'],
    });

    // Cache populated after first run.
    const cacheFiles = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true }),
    );
    expect(cacheFiles.length).toBe(2); // base .png + .webp
    const baseCache = cacheFiles.find((f) => f.endsWith('.png'));
    const webpCache = cacheFiles.find((f) => f.endsWith('.webp'));
    expect(baseCache).toBeDefined();
    expect(webpCache).toBeDefined();

    // Wipe the output tree and rebuild: outputs should come back from cache.
    await rm(outputDir, { recursive: true, force: true });
    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes,
      cacheDir,
      formats: ['webp'],
    });
    expect(count).toBe(2);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png.webp'))).toBe(
      true,
    );

    // Cache file count unchanged — no new entries were written.
    const cacheFilesAfter = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true }),
    );
    expect(cacheFilesAfter.length).toBe(2);
  });
});

describe('collapseDegenerateSrcset', () => {
  test('strips srcset+sizes when every entry resolves to the same URL (SVG cover, issue #534)', () => {
    // What Source's feature-image.hbs produces for an SVG `feature_image`:
    // every `{{img_url cover size="..."}}` returns the same URL because the
    // size segment rewrite is skipped for vector sources. The browser would
    // download the original anyway, so the srcset is just bytes that have to
    // be parsed and discarded.
    const html =
      '<img alt="cover" srcset="/content/images/cover.svg 320w, /content/images/cover.svg 600w, /content/images/cover.svg 960w" sizes="100vw" src="/content/images/cover.svg">';
    const out = collapseDegenerateSrcset(html);
    expect(out).not.toContain('srcset=');
    expect(out).not.toContain('sizes=');
    expect(out).toContain('alt="cover"');
    expect(out).toContain('src="/content/images/cover.svg"');
  });

  test('keeps srcset when entries point at distinct URLs', () => {
    const html =
      '<img srcset="/content/images/size/w320/cover.jpg 320w, /content/images/size/w600/cover.jpg 600w" sizes="100vw" src="/content/images/cover.jpg">';
    expect(collapseDegenerateSrcset(html)).toBe(html);
  });

  test('leaves single-entry srcset alone', () => {
    // A solo entry is unusual but legal (e.g. for retina-only fallbacks);
    // dedupe logic only fires when there are at least two entries to compare.
    const html = '<img srcset="/content/images/cover.svg 1x" src="/content/images/cover.svg">';
    expect(collapseDegenerateSrcset(html)).toBe(html);
  });

  test('handles srcset with newlines and extra whitespace between entries', () => {
    // Source's HBS template breaks srcset across lines for readability — the
    // raw HTML the renderer produces preserves that whitespace.
    const html =
      '<img\n  srcset="/content/images/c.svg 320w,\n          /content/images/c.svg 600w,\n          /content/images/c.svg 960w"\n  sizes="(max-width: 1200px) 100vw, 1120px"\n  src="/content/images/c.svg">';
    const out = collapseDegenerateSrcset(html);
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('sizes=');
    expect(out).toContain('src="/content/images/c.svg"');
  });

  test('is a no-op when html contains no <img srcset>', () => {
    const html = '<p>just text and <a href="x">a link</a></p>';
    expect(collapseDegenerateSrcset(html)).toBe(html);
  });

  test('handles density descriptors (1x/2x) the same way as width descriptors', () => {
    const html =
      '<img srcset="/content/images/icon.svg 1x, /content/images/icon.svg 2x" src="/content/images/icon.svg">';
    const out = collapseDegenerateSrcset(html);
    expect(out).not.toContain('srcset');
    expect(out).toContain('src="/content/images/icon.svg"');
  });

  test('preserves self-closing form when stripping attrs', () => {
    const html = '<img srcset="/c.svg 320w, /c.svg 600w" sizes="100vw" src="/c.svg" />';
    const out = collapseDegenerateSrcset(html);
    expect(out.endsWith('/>')).toBe(true);
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('sizes=');
  });
});

describe('collapseDegenerateSrcsetIntoContent', () => {
  test('rewrites post.html, post.feed_html, and page.html', () => {
    const post = {
      id: 'p1',
      slug: 'p1',
      html: '<img srcset="/content/images/x.svg 320w, /content/images/x.svg 600w" sizes="100vw" src="/content/images/x.svg">',
      feed_html:
        '<img srcset="/content/images/y.svg 320w, /content/images/y.svg 600w" sizes="100vw" src="/content/images/y.svg">',
    } as unknown as Post;
    const page = {
      id: 'pg1',
      slug: 'pg1',
      html: '<img srcset="/content/images/z.svg 320w, /content/images/z.svg 600w" sizes="100vw" src="/content/images/z.svg">',
    } as unknown as Page;
    const content: ContentGraph = {
      posts: [post],
      pages: [page],
      authors: [],
      tags: [],
    } as unknown as ContentGraph;
    collapseDegenerateSrcsetIntoContent({ content });
    expect(post.html).not.toContain('srcset');
    expect(post.feed_html).not.toContain('srcset');
    expect(page.html).not.toContain('srcset');
    expect(post.html).toContain('src="/content/images/x.svg"');
    expect(page.html).toContain('src="/content/images/z.svg"');
  });
});

describe('densifyWidths', () => {
  test('fills a gap wider than the ratio with a geometric-mean width', () => {
    expect(densifyWidths([600, 1000], 1.5)).toEqual([600, 770, 1000]);
  });

  test('leaves an already-dense ladder unchanged (idempotent)', () => {
    const dense = densifyWidths([600, 1000], 1.5);
    expect(densifyWidths(dense, 1.5)).toEqual(dense);
  });

  test('densifies every gap of a multi-step ladder', () => {
    const out = densifyWidths([300, 600, 1000, 2000], 1.5);
    expect(out).toEqual([300, 420, 600, 770, 1000, 1410, 2000]);
    for (let i = 1; i < out.length; i += 1) {
      expect((out[i] as number) / (out[i - 1] as number)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  test('dedupes and sorts the input', () => {
    expect(densifyWidths([1000, 600, 600], 5)).toEqual([600, 1000]);
  });

  test('returns the input untouched when ratio <= 1 or fewer than two widths', () => {
    expect(densifyWidths([600, 1000], 1)).toEqual([600, 1000]);
    expect(densifyWidths([600], 1.5)).toEqual([600]);
    expect(densifyWidths([], 1.5)).toEqual([]);
  });

  test('drops non-positive and non-finite widths', () => {
    expect(densifyWidths([0, -10, 600, Number.NaN, 1000], 1.5)).toEqual([600, 770, 1000]);
  });
});

describe('densifyImageSrcset', () => {
  const ladder = [300, 420, 600, 770, 1000, 1410, 2000];

  test('inserts an intermediate width into a 600w->1000w theme srcset', () => {
    const html =
      '<img class="post-card-image" srcset="/content/images/size/w600/2022/cover.jpeg 600w, /content/images/size/w1000/2022/cover.jpeg 1000w" sizes="(max-width: 1000px) 400px, 800px">';
    const out = densifyImageSrcset(html, { ratio: 1.5, ladder });
    expect(out).toContain('/content/images/size/w770/2022/cover.jpeg 770w');
    // Existing widths and order preserved, sizes untouched.
    expect(out).toContain('/content/images/size/w600/2022/cover.jpeg 600w');
    expect(out).toContain('/content/images/size/w1000/2022/cover.jpeg 1000w');
    expect(out).toContain('sizes="(max-width: 1000px) 400px, 800px"');
    expect(out.indexOf('w600')).toBeLessThan(out.indexOf('w770'));
    expect(out.indexOf('w770')).toBeLessThan(out.indexOf('w1000'));
  });

  test('preserves a format/ segment when inserting widths', () => {
    const html =
      '<img srcset="/content/images/size/w600/format/webp/a.jpg.webp 600w, /content/images/size/w1000/format/webp/a.jpg.webp 1000w">';
    const out = densifyImageSrcset(html, { ratio: 1.5, ladder });
    expect(out).toContain('/content/images/size/w770/format/webp/a.jpg.webp 770w');
  });

  test('is a no-op when the srcset is already within ratio', () => {
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w770/a.jpg 770w">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder })).toBe(html);
  });

  test('skips inserted widths that meet or exceed the source width', () => {
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w1000/a.jpg 1000w">';
    // Source is only 700px wide: w770 would upscale -> 404, so it is dropped.
    const out = densifyImageSrcset(html, {
      ratio: 1.5,
      ladder,
      sourceWidthFor: () => 700,
    });
    expect(out).toBe(html);
  });

  test('leaves a srcset with density (x) descriptors untouched', () => {
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 1x, /content/images/size/w1000/a.jpg 2x">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder })).toBe(html);
  });

  test('leaves a srcset mixing different sources untouched', () => {
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w1000/b.jpg 1000w">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder })).toBe(html);
  });

  test('densifies the sized gaps when the tail is an original-url (source below top tier)', () => {
    // img_url drops the /size/ segment and emits the bare original for any theme
    // size whose width meets/exceeds the source intrinsic width (upscale
    // avoidance). A card/feature srcset for a smaller source therefore mixes
    // /size/wXXX/ entries with an original-url tail. The 600->1000 gap (1.67x)
    // must still be filled instead of bailing the whole <img>.
    const html =
      '<img class="post-card-image" srcset="/content/images/size/w300/2024/cover.jpg 300w, /content/images/size/w600/2024/cover.jpg 600w, /content/images/size/w1000/2024/cover.jpg 1000w, /content/images/2024/cover.jpg 1600w" sizes="400px">';
    const out = densifyImageSrcset(html, { ratio: 1.5, ladder, sourceWidthFor: () => 1048 });
    expect(out).toContain('/content/images/size/w770/2024/cover.jpg 770w');
    // The original tail entry is preserved as-is (never rewritten to a /size/ URL
    // that would 404), and order stays ascending.
    expect(out).toContain('/content/images/2024/cover.jpg 1600w');
    expect(out.indexOf('w770')).toBeLessThan(out.indexOf('w1000'));
    expect(out.indexOf('w1000')).toBeLessThan(out.indexOf('/content/images/2024/cover.jpg 1600w'));
    // sourceWidthFor still caps inserts: nothing >= 1048 is added.
    expect(out).not.toContain('w1410');
  });

  test('preserves a webp format segment while densifying with an original tail', () => {
    const html =
      '<img srcset="/content/images/size/w600/format/webp/a.jpg.webp 600w, /content/images/size/w1000/format/webp/a.jpg.webp 1000w, /content/images/a.jpg 1600w">';
    const out = densifyImageSrcset(html, { ratio: 1.5, ladder, sourceWidthFor: () => 1200 });
    expect(out).toContain('/content/images/size/w770/format/webp/a.jpg.webp 770w');
    expect(out).toContain('/content/images/a.jpg 1600w');
  });

  test('still bails when a non-sized entry is a different source (not the original)', () => {
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w1000/a.jpg 1000w, /content/images/other.jpg 1600w">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder, sourceWidthFor: () => 1200 })).toBe(html);
  });

  test('fills the gap between the largest sized width and the original tail', () => {
    // Source 1500px: theme sizes 1600/2000 exceed it (originals), 1000 shrinks.
    // 1000->1600 is a 1.6x gap; w1410 (< 1500) must be inserted as a /size/ URL.
    const html =
      '<img srcset="/content/images/size/w300/a.jpg 300w, /content/images/size/w600/a.jpg 600w, /content/images/size/w1000/a.jpg 1000w, /content/images/a.jpg 1600w, /content/images/a.jpg 2000w">';
    const out = densifyImageSrcset(html, { ratio: 1.5, ladder, sourceWidthFor: () => 1500 });
    expect(out).toContain('/content/images/size/w1410/a.jpg 1410w');
  });

  test('leaves remote / non-Ghost srcsets untouched', () => {
    const html =
      '<img srcset="https://cdn.example.com/a-600.jpg 600w, https://cdn.example.com/a-1000.jpg 1000w">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder })).toBe(html);
  });

  test('is idempotent across repeated runs', () => {
    const html =
      '<img srcset="/content/images/size/w300/a.jpg 300w, /content/images/size/w1000/a.jpg 1000w">';
    const once = densifyImageSrcset(html, { ratio: 1.5, ladder });
    expect(densifyImageSrcset(once, { ratio: 1.5, ladder })).toBe(once);
  });

  test('leaves an <img> already inside a <picture> untouched', () => {
    const html =
      '<picture><source type="image/webp" srcset="/content/images/size/w600/a.jpg.webp 600w"><img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w1000/a.jpg 1000w"></picture>';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder })).toBe(html);
  });

  test('does nothing without a srcset or with an empty ladder', () => {
    const plain = '<img src="/content/images/2022/cover.jpeg">';
    expect(densifyImageSrcset(plain, { ratio: 1.5, ladder })).toBe(plain);
    const html =
      '<img srcset="/content/images/size/w600/a.jpg 600w, /content/images/size/w1000/a.jpg 1000w">';
    expect(densifyImageSrcset(html, { ratio: 1.5, ladder: [] })).toBe(html);
  });
});

describe('densifyImageSrcset + generateThemeImageSizeVariants integration', () => {
  test('every width densify inserts into a theme srcset is materialised on disk (no 404)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'laurel-densify-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, '2022/cover.png'), 1600, 1000);
    const outputDir = join(cwd, 'dist');
    const cacheDir = join(cwd, '.cache');
    const config = { content: { assets_dir: assetsDir } } as unknown as LaurelConfig;

    const ratio = 1.5;
    const themeKeys = {
      xs: { width: 160 },
      s: { width: 320 },
      m: { width: 600 },
      l: { width: 960 },
      xl: { width: 1200 },
      xxl: { width: 2000 },
    };
    // Mirror computeDensifyParams: ladder + synthetic width-only entries.
    const themeKeyWidths = Object.values(themeKeys).map((s) => s.width);
    const ladder = densifyWidths(themeKeyWidths, ratio);
    const merged: Record<string, { width: number }> = { ...themeKeys };
    const existing = new Set(themeKeyWidths);
    for (const w of ladder) {
      if (!existing.has(w)) merged[`__densify_w${w}`] = { width: w };
    }

    await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: merged,
      cacheDir,
      formats: ['webp'],
    });

    // The Source card srcset: webp format variants at the theme key widths.
    const srcsetEntries = themeKeyWidths
      .map((w) => `/content/images/size/w${w}/format/webp/2022/cover.png.webp ${w}w`)
      .join(', ');
    const html = `<img srcset="${srcsetEntries}">`;
    const out = densifyImageSrcset(html, { ratio, ladder, sourceWidthFor: () => 1600 });

    // densify must have inserted at least one width.
    expect(out).not.toBe(html);

    const widthsOf = (s: string): number[] =>
      [...s.matchAll(/\/size\/w(\d+)\//g)].map((m) => Number.parseInt(m[1] ?? '', 10));
    const before = new Set(widthsOf(html));
    const inserted = widthsOf(out).filter((w) => !before.has(w));
    expect(inserted).toEqual([230, 440, 760, 1550]);

    // Every width densify *inserts* must exist on disk (the contract: never emit
    // a 404). Pre-existing theme widths that upscale the source (w2000 here) are
    // the theme's own concern and are not asserted.
    for (const w of inserted) {
      expect(w).toBeLessThan(1600);
      expect(
        existsSync(
          join(outputDir, 'content/images/size', `w${w}`, 'format/webp/2022/cover.png.webp'),
        ),
      ).toBe(true);
    }
  });
});
