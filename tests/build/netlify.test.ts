import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitNetlifyHeaders,
  emitNetlifyRedirects,
  formatNetlifyRedirectsBody,
} from '~/build/netlify.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-netlify-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('emitNetlifyHeaders', () => {
  test('does not emit _headers when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: false, headers: DEFAULT_HEADERS_CONFIG });

    expect(existsSync(join(outputDir, '_headers'))).toBe(false);
  });

  test('emits _headers at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });

  test('pins fingerprinted theme assets to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });

  test('pins content image paths to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain(
      '/content/images/*\n  Cache-Control: public, max-age=31536000, immutable',
    );
  });

  test('forces the catch-all rule to revalidate so HTML never goes stale', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toMatch(
      /\/\*\n(?:\x20{2}[^\n]+\n)*\x20{2}Cache-Control: public, max-age=0, must-revalidate/,
    );
  });

  test('sets baseline security headers on the catch-all rule', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('X-Content-Type-Options: nosniff');
    expect(body).toContain('Referrer-Policy: strict-origin-when-cross-origin');
  });

  test('places the catch-all rule after the more specific rules so asset overrides win', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    const assetsIdx = body.indexOf('/assets/*');
    const catchAllIdx = body.indexOf('\n/*\n');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitNetlifyHeaders({ outputDir, enabled: true, headers: DEFAULT_HEADERS_CONFIG });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });

  test('produces the same _headers content as Cloudflare Pages so deploy targets share defaults', async () => {
    const { emitCloudflarePagesHeaders } = await import('~/build/cloudflare-pages.ts');
    const netlifyDir = await makeOutputDir();
    const cfDir = await makeOutputDir();

    await emitNetlifyHeaders({
      outputDir: netlifyDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });
    await emitCloudflarePagesHeaders({
      outputDir: cfDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const netlifyBody = await readFile(join(netlifyDir, '_headers'), 'utf8');
    const cfBody = await readFile(join(cfDir, '_headers'), 'utf8');
    expect(netlifyBody).toBe(cfBody);
  });
});

describe('formatNetlifyRedirectsBody', () => {
  test('emits one space-separated rule per line with the status code', () => {
    const body = formatNetlifyRedirectsBody([
      { from: '/old', to: '/new', status: 301, force: false },
      { from: '/feed', to: '/rss.xml', status: 302, force: false },
    ]);
    expect(body).toContain('/old  /new  301');
    expect(body).toContain('/feed  /rss.xml  302');
  });

  test('appends a `!` suffix on the status code when `force` is true', () => {
    const body = formatNetlifyRedirectsBody([
      { from: '/forced', to: '/dest', status: 301, force: true },
    ]);
    expect(body).toContain('/forced  /dest  301!');
  });

  test('omits the `!` suffix when `force` is false', () => {
    const body = formatNetlifyRedirectsBody([
      { from: '/soft', to: '/dest', status: 301, force: false },
    ]);
    expect(body).toContain('/soft  /dest  301');
    expect(body).not.toContain('301!');
  });

  test('honors all four supported status codes', () => {
    const body = formatNetlifyRedirectsBody([
      { from: '/p', to: '/P', status: 301, force: true },
      { from: '/t', to: '/T', status: 302, force: false },
      { from: '/r', to: '/R', status: 307, force: true },
      { from: '/q', to: '/Q', status: 308, force: false },
    ]);
    expect(body).toContain('/p  /P  301!');
    expect(body).toContain('/t  /T  302');
    expect(body).toContain('/r  /R  307!');
    expect(body).toContain('/q  /Q  308');
  });

  test('terminates the body with a trailing newline', () => {
    const body = formatNetlifyRedirectsBody([{ from: '/a', to: '/b', status: 301, force: false }]);
    expect(body.endsWith('\n')).toBe(true);
  });
});

describe('emitNetlifyRedirects', () => {
  test('does not emit _redirects when netlify is disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyRedirects({
      outputDir,
      rules: [{ from: '/a', to: '/b', status: 301, force: false }],
      enabled: false,
    });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(false);
  });

  test('does not emit _redirects when no rules are provided', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyRedirects({ outputDir, rules: [], enabled: true });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(false);
  });

  test('writes a fresh _redirects when no prior file exists', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyRedirects({
      outputDir,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/old  /new  301');
  });

  test('writes the `!` suffix for `force: true` rules end-to-end', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyRedirects({
      outputDir,
      rules: [{ from: '/forced', to: '/dest', status: 301, force: true }],
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/forced  /dest  301!');
  });

  test('prepends custom rules before an existing _redirects from another emitter', async () => {
    const outputDir = await makeOutputDir();
    await writeFile(
      join(outputDir, '_redirects'),
      '# api shadows\n/ghost/api/content/posts/  /ghost/api/content/posts/index.json  200\n',
    );

    await emitNetlifyRedirects({
      outputDir,
      rules: [{ from: '/feed', to: '/rss.xml', status: 302, force: false }],
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    const customIdx = body.indexOf('/feed  /rss.xml');
    const apiIdx = body.indexOf('/ghost/api/content/posts/');
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeGreaterThan(customIdx);
  });

  test('collapses duplicate `from` entries and keeps the first force flag', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyRedirects({
      outputDir,
      rules: [
        { from: '/dup', to: '/first', status: 301, force: true },
        { from: '/dup', to: '/second', status: 302, force: false },
      ],
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/dup  /first  301!');
    expect(body).not.toContain('/second');
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitNetlifyRedirects({
      outputDir,
      rules: [{ from: '/a', to: '/b', status: 301, force: false }],
      enabled: true,
    });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(true);
  });
});
