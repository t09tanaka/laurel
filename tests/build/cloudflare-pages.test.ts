import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitCloudflarePagesHeaders } from '~/build/cloudflare-pages.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-cf-pages-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('emitCloudflarePagesHeaders', () => {
  test('does not emit _headers when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    expect(existsSync(join(outputDir, '_headers'))).toBe(false);
  });

  test('emits _headers at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });

  test('pins fingerprinted theme assets to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });

  test('pins content image paths to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain(
      '/content/images/*\n  Cache-Control: public, max-age=31536000, immutable',
    );
  });

  test('forces the catch-all rule to revalidate so HTML never goes stale', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toMatch(
      /\/\*\n(?:\x20{2}[^\n]+\n)*\x20{2}Cache-Control: public, max-age=0, must-revalidate/,
    );
  });

  test('sets baseline security headers on the catch-all rule', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('X-Content-Type-Options: nosniff');
    expect(body).toContain('Referrer-Policy: strict-origin-when-cross-origin');
  });

  test('places the catch-all rule after the more specific rules so asset overrides win', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    const assetsIdx = body.indexOf('/assets/*');
    const catchAllIdx = body.indexOf('\n/*\n');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitCloudflarePagesHeaders({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
    });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });
});

describe('Cloudflare deployment docs', () => {
  test('document Workers Static Assets 404 handling for Nectar output', async () => {
    const root = join(import.meta.dir, '..', '..');
    const guide = await readFile(join(root, 'docs', 'deploy', 'cloudflare-pages.md'), 'utf8');
    const tutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');

    expect(guide).toContain('Cloudflare Workers Static Assets');
    expect(guide).toContain('not_found_handling = "404-page"');
    expect(guide).toContain('Nectar emits separate');
    expect(guide).toContain('dist/404.html');
    expect(guide).toContain('not_found_handling = "single-page-application"');
    expect(guide).toContain('direct navigation / 404 semantics');
    expect(tutorial).toContain('Cloudflare Workers Static Assets');
    expect(tutorial).toContain('not_found_handling = "404-page"');
    expect(tutorial).toContain('not_found_handling = "single-page-application"');
    expect(tutorial).toContain('missing navigation requests');
    expect(tutorial).toContain('intended 404 behavior');
  });
});

describe('Cloudflare Pages deploy samples', () => {
  test('documents the direct Wrangler deploy workflow', async () => {
    const workflowPath = join(
      import.meta.dir,
      '..',
      '..',
      'examples',
      'ci',
      'cloudflare-pages.yml',
    );
    const body = await readFile(workflowPath, 'utf8');

    expect(body).toContain('cloudflare/wrangler-action@v3');
    expect(body).toContain('CLOUDFLARE_API_TOKEN');
    expect(body).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(body).toContain('CLOUDFLARE_PROJECT_NAME');
    expect(body).toContain('pages deploy dist --project-name=${{ env.CLOUDFLARE_PROJECT_NAME }}');
    expect(body).toContain('examples/deploy/cloudflare-pages/wrangler.toml');
  });

  test('includes a Wrangler Pages config sample for dist deploys', async () => {
    const samplePath = join(
      import.meta.dir,
      '..',
      '..',
      'examples',
      'deploy',
      'cloudflare-pages',
      'wrangler.toml',
    );
    const body = await readFile(samplePath, 'utf8');

    expect(existsSync(samplePath)).toBe(true);
    expect(body).toContain('name = "my-nectar-site"');
    expect(body).toContain('pages_build_output_dir = "./dist"');
    expect(body).toContain('compatibility_date = "2026-05-20"');
  });
});
