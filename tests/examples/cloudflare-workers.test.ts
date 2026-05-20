import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import worker from '../../examples/cloudflare-workers/index.ts';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'cloudflare-workers');

function makeEnv(): { ASSETS: Fetcher } {
  return {
    ASSETS: {
      async fetch(request: Request | string) {
        const url = new URL(typeof request === 'string' ? request : request.url);
        if (url.pathname === '/_routes-manifest.json') {
          return Response.json({
            version: 1,
            redirects: [{ source: '/old', destination: '/new/', status: 308 }],
            headers: [
              {
                source: '/assets/*',
                headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
              },
              {
                source: '/*',
                headers: [
                  { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
                  { key: 'X-Content-Type-Options', value: 'nosniff' },
                ],
              },
            ],
          });
        }
        return new Response('asset', {
          headers: { 'Cache-Control': 'cloudflare-default' },
        });
      },
    } as Fetcher,
  };
}

describe('examples/cloudflare-workers Static Assets sample', () => {
  test('configures Wrangler to serve the Nectar dist directory through Static Assets', async () => {
    const body = await readFile(join(sampleDir, 'wrangler.toml'), 'utf8');

    expect(body).toContain('main = "index.ts"');
    expect(body).toContain('[assets]');
    expect(body).toContain('directory = "dist"');
    expect(body).toContain('binding = "ASSETS"');
    expect(body).toContain('not_found_handling = "404-page"');
    expect(body).toContain('run_worker_first = true');
  });

  test('loads Nectar routes manifest before delegating to the Static Assets binding', async () => {
    const body = await readFile(join(sampleDir, 'index.ts'), 'utf8');

    expect(body).toContain('ASSETS: Fetcher');
    expect(body).toContain('_routes-manifest.json');
    expect(body).toContain('findRedirect');
    expect(body).toContain('applyHeaderRules');
    expect(body).toContain('ASSETS.fetch(request)');
  });

  test('applies manifest redirects before fetching assets', async () => {
    const response = await worker.fetch(new Request('https://example.test/old'), makeEnv());

    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://example.test/new/');
  });

  test('applies matching manifest headers without letting catch-all cache override asset cache', async () => {
    const response = await worker.fetch(
      new Request('https://example.test/assets/app.css'),
      makeEnv(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('is linked from the hosting docs', async () => {
    const hosting = await readFile(join(root, 'docs', 'HOSTING.md'), 'utf8');
    const cloudflare = await readFile(join(root, 'docs', 'deploy', 'cloudflare-pages.md'), 'utf8');

    expect(hosting).toContain('examples/cloudflare-workers/wrangler.toml');
    expect(cloudflare).toContain('examples/cloudflare-workers/wrangler.toml');
    expect(cloudflare).toContain('[deploy.cloudflare_workers]');
    expect(cloudflare).toContain('dist/_routes-manifest.json');
    expect(cloudflare).toContain('Workers Static Assets does not read `_headers` or `_redirects`');
    expect(cloudflare).toContain('run_worker_first = true');
  });
});
