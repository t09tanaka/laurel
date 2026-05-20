import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import worker from '../../examples/r2/worker.ts';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'r2');

class R2ObjectStub {
  readonly body: ReadableStream<Uint8Array>;
  readonly httpEtag: string;
  readonly httpMetadata: { contentType?: string };

  constructor(body: string, contentType = 'text/plain') {
    this.body = new Response(body).body ?? new ReadableStream();
    this.httpEtag = '"etag"';
    this.httpMetadata = { contentType };
  }

  writeHttpMetadata(headers: Headers): void {
    if (this.httpMetadata.contentType) {
      headers.set('Content-Type', this.httpMetadata.contentType);
    }
  }
}

function makeEnv(objects: Record<string, R2ObjectStub | string>): {
  SITE: R2Bucket;
  keys: string[];
} {
  const keys: string[] = [];
  return {
    SITE: {
      async get(key: string) {
        keys.push(key);
        const obj = objects[key];
        if (!obj) return null;
        return typeof obj === 'string' ? new R2ObjectStub(obj, 'text/html') : obj;
      },
    } as unknown as R2Bucket,
    keys,
  };
}

describe('examples/r2 Worker sample', () => {
  test('appends index.html when serving a slug directory from R2', async () => {
    const env = makeEnv({ 'posts/hello/index.html': '<!doctype html>hello' });

    const response = await worker.fetch(new Request('https://example.test/posts/hello/'), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hello');
    expect(env.keys).toEqual(['_routes-manifest.json', 'posts/hello/index.html']);
  });

  test('applies manifest redirects before reading the requested R2 object', async () => {
    const env = makeEnv({
      '_routes-manifest.json': JSON.stringify({
        version: 1,
        redirects: [{ source: '/old', destination: '/new/', status: 308 }],
        headers: [],
      }),
    });

    const response = await worker.fetch(new Request('https://example.test/old'), env);

    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://example.test/new/');
    expect(env.keys).toEqual(['_routes-manifest.json']);
  });

  test('applies matching manifest headers to R2 responses', async () => {
    const env = makeEnv({
      '_routes-manifest.json': JSON.stringify({
        version: 1,
        redirects: [],
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
      }),
      'assets/app.css': new R2ObjectStub('body{}', 'text/css'),
    });

    const response = await worker.fetch(new Request('https://example.test/assets/app.css'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toBe('text/css');
  });

  test('documents the R2 Worker sample for full-dist R2 hosting', async () => {
    const readme = await readFile(join(root, 'examples', 'README.md'), 'utf8');
    const r2Guide = await readFile(
      join(root, 'docs', 'deploy', 'cloudflare-pages-r2-images.md'),
      'utf8',
    );

    expect(await readFile(join(sampleDir, 'worker.ts'), 'utf8')).toContain('SITE: R2Bucket');
    expect(readme).toContain('examples/r2/worker.ts');
    expect(r2Guide).toContain('examples/r2/worker.ts');
    expect(r2Guide).toContain('<slug>/index.html');
    expect(r2Guide).toContain('dist/_routes-manifest.json');
  });
});
