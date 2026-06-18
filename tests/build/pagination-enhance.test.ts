import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitPaginationEnhanceShim,
  injectPaginationEnhanceScript,
} from '~/build/pagination-enhance.ts';
import { configSchema } from '~/config/schema.ts';

function config(overrides: Record<string, unknown> = {}) {
  return configSchema.parse({
    site: { title: 'X', url: 'https://x.test' },
    ...overrides,
  });
}

const FEED_HTML =
  '<html><head><link rel="next" href="https://x.test/page/2/"></head>' +
  '<body><div class="post-feed"><article class="post-card">1</article></div></body></html>';

describe('emitPaginationEnhanceShim', () => {
  test('writes nothing in the default links mode', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'laurel-pg-'));
    const dest = await emitPaginationEnhanceShim({ config: config(), outputDir });
    expect(dest).toBeNull();
    await expect(stat(join(outputDir, 'pagination/enhance.js'))).rejects.toThrow();
  });

  test('emits the runtime for infinite mode with the configured selectors', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'laurel-pg-'));
    const cfg = config({ components: { pagination: { mode: 'infinite' } } });
    const dest = await emitPaginationEnhanceShim({ config: cfg, outputDir });
    expect(dest).toBe(join(outputDir, 'pagination/enhance.js'));
    const js = await readFile(join(outputDir, 'pagination/enhance.js'), 'utf8');
    expect(js).toContain('var MODE = "infinite"');
    expect(js).toContain('var CONTAINER_SELECTOR = ".post-feed"');
    expect(js).toContain('var ITEM_SELECTOR = ".post-card"');
    expect(js).toContain('IntersectionObserver');
  });

  test('emits a load-more runtime with custom selectors', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'laurel-pg-'));
    const cfg = config({
      components: {
        pagination: {
          mode: 'load-more',
          container_selector: '.gh-postfeed',
          item_selector: '.gh-card',
        },
      },
    });
    await emitPaginationEnhanceShim({ config: cfg, outputDir });
    const js = await readFile(join(outputDir, 'pagination/enhance.js'), 'utf8');
    expect(js).toContain('var MODE = "load-more"');
    expect(js).toContain('var CONTAINER_SELECTOR = ".gh-postfeed"');
    expect(js).toContain('var ITEM_SELECTOR = ".gh-card"');
  });
});

describe('injectPaginationEnhanceScript', () => {
  test('is a no-op in links mode', () => {
    expect(injectPaginationEnhanceScript(FEED_HTML, config())).toBe(FEED_HTML);
  });

  test('injects a deferred script before </head> on a feed page with a next link', () => {
    const cfg = config({ components: { pagination: { mode: 'infinite' } } });
    const out = injectPaginationEnhanceScript(FEED_HTML, cfg);
    expect(out).toContain(
      '<script defer src="/pagination/enhance.js" data-laurel-pagination-enhance></script></head>',
    );
  });

  test('skips pages without a rel="next" link (last page / single pages)', () => {
    const cfg = config({ components: { pagination: { mode: 'infinite' } } });
    const html = '<html><head></head><body><div class="post-feed"></div></body></html>';
    expect(injectPaginationEnhanceScript(html, cfg)).toBe(html);
  });

  test('is idempotent', () => {
    const cfg = config({ components: { pagination: { mode: 'load-more' } } });
    const once = injectPaginationEnhanceScript(FEED_HTML, cfg);
    const twice = injectPaginationEnhanceScript(once, cfg);
    expect(twice).toBe(once);
  });

  test('prefixes the script src with base_path', () => {
    const cfg = config({
      build: { base_path: '/blog/' },
      components: { pagination: { mode: 'infinite' } },
    });
    const out = injectPaginationEnhanceScript(FEED_HTML, cfg);
    expect(out).toContain('src="/blog/pagination/enhance.js"');
  });

  test('stamps the csp nonce when configured', () => {
    const cfg = config({
      build: { csp_nonce: 'abc123' },
      components: { pagination: { mode: 'infinite' } },
    });
    const out = injectPaginationEnhanceScript(FEED_HTML, cfg, cfg.build.csp_nonce);
    expect(out).toContain('data-laurel-pagination-enhance nonce="abc123"></script>');
  });
});
