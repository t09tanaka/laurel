import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildVercelConfig,
  buildVercelHeaders,
  buildVercelRedirects,
  emitVercelJson,
} from '~/build/vercel.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-vercel-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('buildVercelHeaders', () => {
  test('translates glob `*` patterns to path-to-regexp `(.*)` so source matches the same paths', () => {
    const rules = buildVercelHeaders(DEFAULT_HEADERS_CONFIG);
    const sources = rules.map((r) => r.source);
    expect(sources).toContain('/assets/(.*)');
    expect(sources).toContain('/content/images/(.*)');
    expect(sources).toContain('/(.*)');
  });

  test('emits a Cache-Control header entry for every cache rule', () => {
    const rules = buildVercelHeaders(DEFAULT_HEADERS_CONFIG);
    const assets = rules.find((r) => r.source === '/assets/(.*)');
    expect(assets?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    });
  });

  test('attaches baseline security headers to the catch-all rule', () => {
    const rules = buildVercelHeaders(DEFAULT_HEADERS_CONFIG);
    const catchAll = rules.find((r) => r.source === '/(.*)');
    expect(catchAll).toBeDefined();
    expect(catchAll?.headers).toContainEqual({ key: 'X-Content-Type-Options', value: 'nosniff' });
    expect(catchAll?.headers).toContainEqual({
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    });
  });

  test('places the catch-all rule after the more specific rules so asset overrides win', () => {
    const rules = buildVercelHeaders(DEFAULT_HEADERS_CONFIG);
    const assetsIdx = rules.findIndex((r) => r.source === '/assets/(.*)');
    const catchAllIdx = rules.findIndex((r) => r.source === '/(.*)');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('honors custom security headers via the free-form `custom` map', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          security: { custom: { 'X-Robots-Tag': 'noindex' } },
        },
      },
    }).deploy.headers;
    const rules = buildVercelHeaders(headers);
    const catchAll = rules.find((r) => r.source === '/(.*)');
    expect(catchAll?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
  });

  test('drops cache rules with a duplicate pattern so emission order is stable', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          cache_rules: [
            { pattern: '/assets/*', cache_control: 'public, max-age=60' },
            { pattern: '/assets/*', cache_control: 'public, max-age=3600' },
            { pattern: '/*', cache_control: 'public, max-age=0, must-revalidate' },
          ],
        },
      },
    }).deploy.headers;
    const rules = buildVercelHeaders(headers);
    const assets = rules.filter((r) => r.source === '/assets/(.*)');
    expect(assets).toHaveLength(1);
    expect(assets[0]?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=60',
    });
  });
});

describe('buildVercelRedirects', () => {
  test('maps each canonical rule to source/destination/statusCode', () => {
    const rules = buildVercelRedirects([
      { from: '/old', to: '/new', status: 301, force: false },
      { from: '/feed', to: '/rss.xml', status: 302, force: false },
    ]);
    expect(rules).toEqual([
      { source: '/old', destination: '/new', statusCode: 301 },
      { source: '/feed', destination: '/rss.xml', statusCode: 302 },
    ]);
  });

  test('uses `statusCode` for every supported HTTP status code', () => {
    const rules = buildVercelRedirects([
      { from: '/p', to: '/P', status: 301, force: false },
      { from: '/t', to: '/T', status: 302, force: false },
      { from: '/r', to: '/R', status: 307, force: false },
      { from: '/q', to: '/Q', status: 308, force: false },
    ]);
    expect(rules.map((r) => r.statusCode)).toEqual([301, 302, 307, 308]);
  });

  test('treats the `force` flag as informational because Vercel always honors redirects', () => {
    const rules = buildVercelRedirects([
      { from: '/forced', to: '/dest', status: 301, force: true },
      { from: '/soft', to: '/dest', status: 301, force: false },
    ]);
    for (const r of rules) {
      expect(Object.keys(r)).toEqual(['source', 'destination', 'statusCode']);
    }
  });

  test('translates glob `*` in the source path to path-to-regexp `(.*)`', () => {
    const rules = buildVercelRedirects([{ from: '/old/*', to: '/new', status: 301, force: false }]);
    expect(rules[0]?.source).toBe('/old/(.*)');
  });

  test('collapses duplicate `from` entries and keeps the first', () => {
    const rules = buildVercelRedirects([
      { from: '/dup', to: '/first', status: 301, force: true },
      { from: '/dup', to: '/second', status: 302, force: false },
    ]);
    expect(rules).toEqual([{ source: '/dup', destination: '/first', statusCode: 301 }]);
  });
});

describe('buildVercelConfig', () => {
  test('folds headers and redirects into a single object', () => {
    const config = buildVercelConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      trailingSlash: 'always',
    });
    expect(config.headers).toBeDefined();
    expect(config.redirects).toEqual([{ source: '/old', destination: '/new', statusCode: 301 }]);
  });

  test('combines cleanUrls and trailingSlash only for always-slash builds', () => {
    const build = configSchema.parse({
      site: { title: 'x' },
      build: { trailing_slash: 'always' },
    }).build;

    const config = buildVercelConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: build.trailing_slash,
    });

    expect(config.cleanUrls).toBe(true);
    expect(config.trailingSlash).toBe(true);
  });

  test('uses a non-looping Vercel URL combo when trailing slashes are not forced', () => {
    const build = configSchema.parse({
      site: { title: 'x' },
      build: { trailing_slash: 'never' },
    }).build;

    const config = buildVercelConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: build.trailing_slash,
    });

    expect(config.cleanUrls).toBe(true);
    expect(config.trailingSlash).toBe(false);
  });

  test('omits the `redirects` key entirely when there are no rules', () => {
    const config = buildVercelConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });
    expect(config.redirects).toBeUndefined();
  });

  test('omits the `headers` key entirely when there are no cache rules and no security headers', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          cache_rules: [],
          security: {
            content_type_options: null,
            referrer_policy: null,
          },
        },
      },
    }).deploy.headers;
    const config = buildVercelConfig({ headers, rules: [], trailingSlash: 'always' });
    expect(config.headers).toBeUndefined();
  });
});

describe('emitVercelJson', () => {
  test('does not emit vercel.json when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitVercelJson({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });

    expect(existsSync(join(outputDir, 'vercel.json'))).toBe(false);
  });

  test('writes vercel.json at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitVercelJson({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });

    expect(existsSync(join(outputDir, 'vercel.json'))).toBe(true);
  });

  test('produces valid JSON terminated with a trailing newline', async () => {
    const outputDir = await makeOutputDir();

    await emitVercelJson({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      trailingSlash: 'always',
    });

    const body = await readFile(join(outputDir, 'vercel.json'), 'utf8');
    expect(body.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(body) as {
      cleanUrls?: unknown;
      trailingSlash?: unknown;
      headers?: unknown[];
      redirects?: unknown[];
    };
    expect(parsed.cleanUrls).toBe(true);
    expect(parsed.trailingSlash).toBe(true);
    expect(Array.isArray(parsed.headers)).toBe(true);
    expect(parsed.redirects).toEqual([{ source: '/old', destination: '/new', statusCode: 301 }]);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitVercelJson({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });

    expect(existsSync(join(outputDir, 'vercel.json'))).toBe(true);
  });
});

describe('examples/ci/vercel.yml', () => {
  test('documents the Vercel CLI prebuilt deploy flow', async () => {
    const workflowPath = join(import.meta.dir, '..', '..', 'examples', 'ci', 'vercel.yml');
    const body = await readFile(workflowPath, 'utf8');

    expect(body).toContain('oven-sh/setup-bun@v2');
    expect(body).toContain('bun install --frozen-lockfile');
    expect(body).toContain('VERCEL_TOKEN');
    expect(body).toContain('VERCEL_ORG_ID');
    expect(body).toContain('VERCEL_PROJECT_ID');
    expect(body).toContain('vercel@latest pull');
    expect(body).toContain('vercel@latest build');
    expect(body).toContain('vercel@latest deploy --prebuilt');
  });
});

describe('Vercel deployment docs', () => {
  test('document Vercel 404.html behavior for Laurel output', async () => {
    const root = join(import.meta.dir, '..', '..');
    const guide = await readFile(join(root, 'docs', 'deploy', 'vercel.md'), 'utf8');
    const security = await readFile(join(root, 'docs', 'security', 'hosting.md'), 'utf8');
    const tutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');

    expect(guide).toContain('Laurel always emits `dist/404.html`');
    expect(guide).toContain('Vercel treats a `404.html` file at the output root');
    expect(guide).toContain('No extra rewrite or `routes` entry');
    expect(guide).toContain('## Clean URLs and trailing slashes');
    expect(guide).toContain('`build.trailing_slash = "always"`');
    expect(guide).toContain('`trailingSlash: false`');
    expect(security).toContain('Keep `cleanUrls: true` with');
    expect(security).toContain('for no-slash builds, use `trailingSlash: false`');
    expect(tutorial).toContain('Every Laurel build includes `dist/404.html`');
    expect(tutorial).toContain('does not need a catch-all rewrite for');
  });
});
