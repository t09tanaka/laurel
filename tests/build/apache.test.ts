import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApacheHtaccess, emitApacheHtaccess, toApacheRewritePattern } from '~/build/apache.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-apache-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('toApacheRewritePattern', () => {
  test('translates root-relative exact paths for .htaccess RewriteRule matching', () => {
    expect(toApacheRewritePattern('/old')).toBe('^old$');
    expect(toApacheRewritePattern('/')).toBe('^$');
  });

  test('translates glob wildcards to regex captures', () => {
    expect(toApacheRewritePattern('/old/*')).toBe('^old/(.*)$');
    expect(toApacheRewritePattern('/blog/*/draft')).toBe('^blog/(.*)/draft$');
  });
});

describe('buildApacheHtaccess', () => {
  test('emits core Apache directives for pretty URLs, 404s, mime types, compression, and ETags', () => {
    const out = buildApacheHtaccess({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });

    expect(out).toContain('DirectoryIndex index.html');
    expect(out).toContain('ErrorDocument 404 /404.html');
    expect(out).toContain('FileETag MTime Size');
    expect(out).toContain('AddType image/avif .avif');
    expect(out).toContain('AddType font/woff2 .woff2');
    expect(out).toContain('AddEncoding br .br');
    expect(out).toContain('AddEncoding gzip .gz');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('maps deploy cache rules to first-match rewrite env flags consumed by mod_headers', () => {
    const out = buildApacheHtaccess({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });

    expect(out).toContain('RewriteCond %{ENV:LAUREL_CACHE_MATCHED} !1');
    expect(out).toContain(
      'RewriteRule ^assets/(.*)$ - [E=LAUREL_CACHE_0:1,E=LAUREL_CACHE_MATCHED:1]',
    );
    expect(out).toContain(
      'RewriteRule ^_images/(.*)$ - [E=LAUREL_CACHE_1:1,E=LAUREL_CACHE_MATCHED:1]',
    );
    expect(out).toContain(
      'Header set Cache-Control "public, max-age=31536000, immutable" env=LAUREL_CACHE_0',
    );
    expect(out).toContain(
      'Header set Cache-Control "public, max-age=31536000, immutable" env=LAUREL_CACHE_1',
    );
    expect(out).toContain(
      'Header set Cache-Control "public, max-age=0, must-revalidate" env=LAUREL_CACHE_3',
    );
    expect(out.indexOf('LAUREL_CACHE_0')).toBeLessThan(out.indexOf('LAUREL_CACHE_3'));
  });

  test('resolves clean URLs to slug index files after redirects and cache markers', () => {
    const out = buildApacheHtaccess({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    expect(out).toContain('RewriteEngine On');
    expect(out).toContain("  # Resolve Laurel's slug/index.html output for clean URLs.");
    expect(out).toContain('RewriteCond %{REQUEST_FILENAME} !-f');
    expect(out).toContain('RewriteCond %{REQUEST_FILENAME}/index.html -f');
    expect(out).toContain('RewriteRule ^(.+[^/])$ $1/index.html [L]');
    expect(out).toContain('RewriteCond %{REQUEST_FILENAME}index.html -f');
    expect(out).toContain('RewriteRule ^(.+)/$ $1/index.html [L]');
    expect(out.indexOf('# Redirects')).toBeLessThan(out.indexOf('# Cache rule markers'));
    expect(out.indexOf('# Cache rule markers')).toBeLessThan(
      out.indexOf("# Resolve Laurel's slug/index.html output"),
    );
  });

  test('attaches baseline and custom security headers via mod_headers', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          security: { custom: { 'X-Robots-Tag': 'noindex' } },
        },
      },
    }).deploy.headers;

    const out = buildApacheHtaccess({ headers, rules: [] });

    expect(out).toContain('Header always set X-Content-Type-Options "nosniff"');
    expect(out).toContain('Header always set Referrer-Policy "strict-origin-when-cross-origin"');
    expect(out).toContain('Header always set X-Robots-Tag "noindex"');
  });

  test('escapes quotes and backslashes inside emitted header values', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          security: { content_security_policy: 'default-src "self"; script-src \\nonce-x' },
        },
      },
    }).deploy.headers;

    const out = buildApacheHtaccess({ headers, rules: [] });

    expect(out).toContain(
      'Header always set Content-Security-Policy "default-src \\"self\\"; script-src \\\\nonce-x"',
    );
  });

  test('emits mod_rewrite redirects with supported status codes in first-match order', () => {
    const out = buildApacheHtaccess({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/old', to: '/new', status: 301, force: false },
        { from: '/feed', to: '/rss.xml', status: 302, force: false },
        { from: '/temp', to: '/next', status: 307, force: false },
        { from: '/perm', to: '/final', status: 308, force: false },
      ],
    });

    expect(out).toContain('RewriteRule ^old$ /new [R=301,L]');
    expect(out).toContain('RewriteRule ^feed$ /rss.xml [R=302,L]');
    expect(out).toContain('RewriteRule ^temp$ /next [R=307,L]');
    expect(out).toContain('RewriteRule ^perm$ /final [R=308,L]');
    expect(out.indexOf('^old$')).toBeLessThan(out.indexOf('^feed$'));
  });

  test('uses regex rewrite rules for wildcard redirects and collapses duplicate sources', () => {
    const out = buildApacheHtaccess({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/old/*', to: '/new', status: 301, force: false },
        { from: '/dup', to: '/first', status: 301, force: false },
        { from: '/dup', to: '/second', status: 302, force: false },
      ],
    });

    expect(out).toContain('RewriteRule ^old/(.*)$ /new [R=301,L]');
    expect(out).toContain('RewriteRule ^dup$ /first [R=301,L]');
    expect(out).not.toContain('/second');
  });
});

describe('emitApacheHtaccess', () => {
  test('does not emit .htaccess when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitApacheHtaccess({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.htaccess'))).toBe(false);
  });

  test('writes .htaccess at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitApacheHtaccess({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    const body = await readFile(join(outputDir, '.htaccess'), 'utf8');
    expect(body).toContain('RewriteRule ^old$ /new [R=301,L]');
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitApacheHtaccess({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.htaccess'))).toBe(true);
  });
});
