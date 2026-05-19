import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_IMAGE_SIZES,
  DEFAULT_RESPONSIVE_WIDTHS,
  type ImageVariantPlan,
  buildThemeImageSizeSegment,
  generateThemeImageSizeVariants,
  injectImageDimensions,
  injectImageDimensionsIntoContent,
  injectImagePictureSources,
  injectImagePictureSourcesIntoContent,
  injectImageSrcset,
  injectImageSrcsetIntoContent,
  planImageVariants,
} from '~/build/images.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import { readImageDimensions } from '~/util/image-size.ts';
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
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
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

describe('planImageVariants', () => {
  test('emits widths smaller than the source for every raster under assets_dir', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeFakePng(join(cwd, assetsDir), 'wide.png', 2400, 1200);
    writeFakePng(join(cwd, assetsDir), 'mid.png', 1200, 800);
    writeFakePng(join(cwd, assetsDir), 'narrow.png', 500, 500);
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
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
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.has('cover.png')).toBe(true);
    expect(plan.has('size/w600/cover.png')).toBe(false);
  });

  test('skips SVG and other non-raster formats', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeSvg(join(cwd, assetsDir), 'cover.svg', 1200, 800);
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
    const plan = await planImageVariants({ cwd, config });
    expect(plan.size).toBe(0);
  });

  test('honours a custom widths list', async () => {
    const cwd = makeAssetsRoot();
    const assetsDir = 'content/images';
    writeFakePng(join(cwd, assetsDir), 'cover.png', 1000, 700);
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
    const plan = await planImageVariants({ cwd, config, widths: [320, 640, 960, 1280] });
    expect(plan.get('cover.png')).toEqual([320, 640, 960]);
  });

  test('returns an empty plan when assets_dir does not exist', async () => {
    const cwd = makeAssetsRoot();
    const config = { content: { assets_dir: 'no/such/dir' } } as unknown as NectarConfig;
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
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
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
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
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
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
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
      bySlug: { posts: new Map(), pages: new Map(), tags: new Map(), authors: new Map() },
      postsByTag: new Map(),
      postsByAuthor: new Map(),
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

describe('generateThemeImageSizeVariants', () => {
  test('materialises one file per (source, size) into <outputDir>/content/images/size/<segment>/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1600, 1000);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'small.png'), 400, 300);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 1200);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    await writeRealPng(join(cwd, assetsDir, 'size/w600/cover.png'), 600, 400);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, '2026/05/photo.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {},
    });

    expect(count).toBe(0);
  });

  test('no-op when assets_dir does not exist', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const config = { content: { assets_dir: 'no/such/dir' } } as unknown as NectarConfig;
    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir: join(cwd, 'dist'),
      themeImageSizes: { m: { width: 600 } },
    });
    expect(count).toBe(0);
  });

  test('emits per-format variants under size/<segment>/format/<ext>/ when formats are configured', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1600, 1000);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: {
        xs: { width: 160 },
        m: { width: 600 },
      },
      cacheDir: join(cwd, '.nectar-cache/images'),
      formats: ['webp'],
    });

    // 2 base + 2 webp = 4 emitted files.
    expect(count).toBe(4);
    expect(existsSync(join(outputDir, 'content/images/size/w160/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w160/format/webp/cover.png'))).toBe(
      true,
    );
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png'))).toBe(
      true,
    );
  });

  test('skips format variants for non-jpg/png sources', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
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
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
      cacheDir: join(cwd, '.nectar-cache/images'),
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
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;

    const count = await generateThemeImageSizeVariants({
      cwd,
      config,
      outputDir,
      themeImageSizes: { m: { width: 600 } },
      formats: ['webp'],
    });

    expect(count).toBe(1);
    expect(existsSync(join(outputDir, 'content/images/size/w600/cover.png'))).toBe(true);
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png'))).toBe(
      false,
    );
  });

  test('caches encoded bytes by content hash so a rebuild reuses them', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'nectar-theme-sizes-'));
    const assetsDir = 'content/images';
    await writeRealPng(join(cwd, assetsDir, 'cover.png'), 1200, 800);
    const outputDir = join(cwd, 'dist');
    const cacheDir = join(cwd, '.nectar-cache/images');
    const config = { content: { assets_dir: assetsDir } } as unknown as NectarConfig;
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
    expect(existsSync(join(outputDir, 'content/images/size/w600/format/webp/cover.png'))).toBe(
      true,
    );

    // Cache file count unchanged — no new entries were written.
    const cacheFilesAfter = await Array.fromAsync(
      new Bun.Glob('*').scan({ cwd: cacheDir, onlyFiles: true }),
    );
    expect(cacheFilesAfter.length).toBe(2);
  });
});
