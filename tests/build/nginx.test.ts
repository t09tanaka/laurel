import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNginxServerBlock, emitNginxConf, toNginxLocationHead } from '~/build/nginx.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-nginx-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('toNginxLocationHead', () => {
  test('collapses the catch-all `/*` to the implicit `location /` block', () => {
    expect(toNginxLocationHead('/*')).toBe('location /');
  });

  test('translates trailing-glob prefixes into `^~` prefix locations so regex matching is short-circuited', () => {
    expect(toNginxLocationHead('/assets/*')).toBe('location ^~ /assets/');
    expect(toNginxLocationHead('/content/images/*')).toBe('location ^~ /content/images/');
  });

  test('emits exact-match `location =` for patterns without wildcards', () => {
    expect(toNginxLocationHead('/about')).toBe('location = /about');
  });

  test('falls back to a regex location when the wildcard is embedded inside the path', () => {
    expect(toNginxLocationHead('/blog/*/draft')).toBe('location ~* ^/blog/.*/draft');
  });
});

describe('buildNginxServerBlock', () => {
  test('emits a `server { ... }` block with the configured root and server_name', () => {
    const out = buildNginxServerBlock({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      root: '/srv/site',
      serverName: 'example.com',
    });
    expect(out).toContain('server {');
    expect(out).toContain('    root /srv/site;');
    expect(out).toContain('    server_name example.com;');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('defaults root to /var/www/nectar and server_name to `_` so the snippet is portable', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    expect(out).toContain('    root /var/www/nectar;');
    expect(out).toContain('    server_name _;');
  });

  test('turns on gzip_static and brotli_static for pre-compressed asset serving', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    expect(out).toContain('    gzip_static on;');
    expect(out).toContain('    brotli_static on;');
  });

  test('emits try_files for SPA-style index.html resolution inside every location', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    const matches = out.match(/try_files \$uri \$uri\/index\.html =404;/g) ?? [];
    // One per non-catchall cache rule (assets, content/images) + the catch-all
    // location. The default schema declares 3 cache rules and one is the
    // catch-all, so we expect at least 3 `try_files` lines.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test('emits one location per cache rule with the matching Cache-Control header', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    expect(out).toContain('    location ^~ /assets/ {');
    expect(out).toContain(
      '        add_header Cache-Control "public, max-age=31536000, immutable" always;',
    );
    expect(out).toContain('    location ^~ /content/images/ {');
    expect(out).toContain('    location / {');
    expect(out).toContain(
      '        add_header Cache-Control "public, max-age=0, must-revalidate" always;',
    );
  });

  test('attaches baseline security headers to every emitted location block', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    // Count occurrences: one per location block (default schema -> assets,
    // content/images, catch-all => 3 locations).
    const ctoMatches = out.match(/add_header X-Content-Type-Options "nosniff" always;/g) ?? [];
    const referrerMatches =
      out.match(/add_header Referrer-Policy "strict-origin-when-cross-origin" always;/g) ?? [];
    expect(ctoMatches.length).toBeGreaterThanOrEqual(3);
    expect(referrerMatches.length).toBeGreaterThanOrEqual(3);
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
    const out = buildNginxServerBlock({ headers, rules: [] });
    expect(out).toContain('add_header X-Robots-Tag "noindex" always;');
  });

  test('escapes embedded quotes and backslashes inside header values', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          security: { content_security_policy: 'default-src "self"; script-src \\nonce-x' },
        },
      },
    }).deploy.headers;
    const out = buildNginxServerBlock({ headers, rules: [] });
    expect(out).toContain(
      'add_header Content-Security-Policy "default-src \\"self\\"; script-src \\\\nonce-x" always;',
    );
  });

  test('always emits a catch-all `location /` block even when cache_rules is empty', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: { headers: { cache_rules: [] } },
    }).deploy.headers;
    const out = buildNginxServerBlock({ headers, rules: [] });
    expect(out).toContain('    location / {');
    // No cache rules => no Cache-Control header for the catch-all.
    expect(out).not.toContain('Cache-Control');
  });

  test('places the catch-all `location /` after more specific prefix locations', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    const assetsIdx = out.indexOf('location ^~ /assets/');
    const catchAllIdx = out.indexOf('location / {');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('emits redirect rules as `location { return <status> <to>; }` lines in input order', () => {
    const out = buildNginxServerBlock({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/old', to: '/new', status: 301, force: false },
        { from: '/feed', to: '/rss.xml', status: 302, force: false },
      ],
    });
    expect(out).toContain('    location = /old { return 301 /new; }');
    expect(out).toContain('    location = /feed { return 302 /rss.xml; }');
    expect(out.indexOf('/old')).toBeLessThan(out.indexOf('/feed'));
  });

  test('passes 307 and 308 through verbatim to nginx `return`', () => {
    const out = buildNginxServerBlock({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/t', to: '/T', status: 307, force: false },
        { from: '/q', to: '/Q', status: 308, force: false },
      ],
    });
    expect(out).toContain('return 307 /T;');
    expect(out).toContain('return 308 /Q;');
  });

  test('collapses duplicate redirect `from` entries and keeps the first', () => {
    const out = buildNginxServerBlock({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/dup', to: '/first', status: 301, force: false },
        { from: '/dup', to: '/second', status: 302, force: false },
      ],
    });
    expect(out).toContain('    location = /dup { return 301 /first; }');
    expect(out).not.toContain('/second');
  });

  test('uses a regex location for wildcard redirects so glob `*` matches a path segment', () => {
    const out = buildNginxServerBlock({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old/*', to: '/new', status: 301, force: false }],
    });
    expect(out).toContain('location ~ ^/old/.*$ { return 301 /new; }');
  });

  test('omits the redirects comment block entirely when there are no redirect rules', () => {
    const out = buildNginxServerBlock({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });
    expect(out).not.toContain('# Redirects');
  });

  test('drops cache rules that share a duplicate URL pattern', () => {
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
    const out = buildNginxServerBlock({ headers, rules: [] });
    const assetsBlocks = out.match(/location \^~ \/assets\/ \{/g) ?? [];
    expect(assetsBlocks).toHaveLength(1);
    expect(out).toContain('add_header Cache-Control "public, max-age=60" always;');
    expect(out).not.toContain('max-age=3600');
  });
});

describe('emitNginxConf', () => {
  test('does not emit nginx.conf when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNginxConf({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.nectar', 'nginx.conf'))).toBe(false);
  });

  test('writes nginx.conf under `.nectar/` rather than the publish root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNginxConf({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.nectar', 'nginx.conf'))).toBe(true);
    // The bare publish root should never expose nginx.conf — nginx would
    // happily 200 it over HTTP if it lived alongside index.html.
    expect(existsSync(join(outputDir, 'nginx.conf'))).toBe(false);
  });

  test('emits a parseable server block terminated with a trailing newline', async () => {
    const outputDir = await makeOutputDir();

    await emitNginxConf({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    const body = await readFile(join(outputDir, '.nectar', 'nginx.conf'), 'utf8');
    expect(body.endsWith('\n')).toBe(true);
    expect(body).toContain('server {');
    expect(body).toContain('}\n');
    expect(body).toContain('location = /old { return 301 /new; }');
  });

  test('creates the `.nectar/` subdirectory when the output dir does not yet contain one', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitNginxConf({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.nectar', 'nginx.conf'))).toBe(true);
  });

  test('threads the configured root and server_name into the emitted file', async () => {
    const outputDir = await makeOutputDir();

    await emitNginxConf({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      root: '/srv/blog',
      serverName: 'blog.example.com',
    });

    const body = await readFile(join(outputDir, '.nectar', 'nginx.conf'), 'utf8');
    expect(body).toContain('    root /srv/blog;');
    expect(body).toContain('    server_name blog.example.com;');
    expect(body).toContain('#   include /srv/blog/.nectar/nginx.conf;');
  });
});
