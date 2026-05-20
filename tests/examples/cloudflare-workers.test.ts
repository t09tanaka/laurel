import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'cloudflare-workers');

describe('examples/cloudflare-workers Static Assets sample', () => {
  test('configures Wrangler to serve the Nectar dist directory through Static Assets', async () => {
    const body = await readFile(join(sampleDir, 'wrangler.toml'), 'utf8');

    expect(body).toContain('main = "index.ts"');
    expect(body).toContain('[assets]');
    expect(body).toContain('directory = "dist"');
    expect(body).toContain('binding = "ASSETS"');
  });

  test('delegates every request to the Static Assets binding', async () => {
    const body = await readFile(join(sampleDir, 'index.ts'), 'utf8');

    expect(body).toContain('ASSETS: Fetcher');
    expect(body).toContain('return ASSETS.fetch(request)');
  });

  test('is linked from the hosting docs', async () => {
    const hosting = await readFile(join(root, 'docs', 'HOSTING.md'), 'utf8');
    const cloudflare = await readFile(join(root, 'docs', 'deploy', 'cloudflare-pages.md'), 'utf8');

    expect(hosting).toContain('examples/cloudflare-workers/wrangler.toml');
    expect(cloudflare).toContain('examples/cloudflare-workers/wrangler.toml');
  });
});
