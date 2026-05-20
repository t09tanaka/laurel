import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCaddyfile, emitCaddyfile } from '~/build/caddy.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-caddy-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('buildCaddyfile', () => {
  test('emits a site block with configured address and root', () => {
    const out = buildCaddyfile({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      root: '/srv/site',
      siteAddress: 'example.com',
    });

    expect(out).toContain('example.com {');
    expect(out).toContain('    root * /srv/site');
    expect(out.endsWith('\n')).toBe(true);
  });

  test('defaults to a portable :80 site address and /var/www/nectar root', () => {
    const out = buildCaddyfile({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });

    expect(out).toContain(':80 {');
    expect(out).toContain('    root * /var/www/nectar');
  });

  test('serves pre-compressed static files with try_files fallback', () => {
    const out = buildCaddyfile({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });

    expect(out).toContain('    encode zstd gzip');
    expect(out).toContain('    try_files {path} {path}/index.html =404');
    expect(out).toContain('    file_server {');
    expect(out).toContain('        precompressed br gzip');
  });

  test('emits cache header matchers for every cache rule', () => {
    const out = buildCaddyfile({ headers: DEFAULT_HEADERS_CONFIG, rules: [] });

    expect(out).toContain('    @cache_0 path /assets/*');
    expect(out).toContain(
      '    header @cache_0 Cache-Control "public, max-age=31536000, immutable"',
    );
    expect(out).toContain('    @cache_1 path /content/images/*');
    expect(out).toContain('    @cache_2 path *');
    expect(out).toContain('    header @cache_2 Cache-Control "public, max-age=0, must-revalidate"');
  });

  test('attaches baseline and custom security headers globally', () => {
    const headers = configSchema.parse({
      site: { title: 'x' },
      deploy: {
        headers: {
          security: { custom: { 'X-Robots-Tag': 'noindex' } },
        },
      },
    }).deploy.headers;
    const out = buildCaddyfile({ headers, rules: [] });

    expect(out).toContain('        X-Content-Type-Options "nosniff"');
    expect(out).toContain('        Referrer-Policy "strict-origin-when-cross-origin"');
    expect(out).toContain('        X-Robots-Tag "noindex"');
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
    const out = buildCaddyfile({ headers, rules: [] });

    expect(out).toContain(
      '        Content-Security-Policy "default-src \\"self\\"; script-src \\\\nonce-x"',
    );
  });

  test('emits redirect rules before static file handling and collapses duplicate sources', () => {
    const out = buildCaddyfile({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/old', to: '/new', status: 301, force: false },
        { from: '/blog/*', to: '/news/', status: 308, force: false },
        { from: '/old', to: '/second', status: 302, force: false },
      ],
    });

    expect(out).toContain('    @redirect_0 path /old');
    expect(out).toContain('    redir @redirect_0 /new 301');
    expect(out).toContain('    @redirect_1 path /blog/*');
    expect(out).toContain('    redir @redirect_1 /news/ 308');
    expect(out).not.toContain('/second');
    expect(out.indexOf('redir @redirect_0')).toBeLessThan(out.indexOf('try_files'));
  });
});

describe('emitCaddyfile', () => {
  test('does not emit Caddyfile when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCaddyfile({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.nectar', 'Caddyfile'))).toBe(false);
  });

  test('writes Caddyfile under `.nectar/` rather than the publish root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCaddyfile({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '.nectar', 'Caddyfile'))).toBe(true);
    expect(existsSync(join(outputDir, 'Caddyfile'))).toBe(false);
  });

  test('emits a Caddyfile terminated with a trailing newline', async () => {
    const outputDir = await makeOutputDir();

    await emitCaddyfile({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
    });

    const body = await readFile(join(outputDir, '.nectar', 'Caddyfile'), 'utf8');
    expect(body.endsWith('\n')).toBe(true);
    expect(body).toContain(':80 {');
    expect(body).toContain('redir @redirect_0 /new 301');
  });
});
