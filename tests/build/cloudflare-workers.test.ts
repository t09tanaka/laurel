import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCloudflareWorkersManifest,
  emitCloudflareWorkersManifest,
} from '~/build/cloudflare-workers.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-cf-workers-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('buildCloudflareWorkersManifest', () => {
  test('folds deploy.headers and redirects.yaml rules into a Worker-readable contract', () => {
    const manifest = buildCloudflareWorkersManifest({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new/', status: 308, force: true }],
    });

    expect(manifest.version).toBe(1);
    expect(manifest.redirects).toEqual([{ source: '/old', destination: '/new/', status: 308 }]);
    expect(manifest.headers).toContainEqual({
      source: '/assets/*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    });
    expect(manifest.headers.at(-1)).toEqual({
      source: '/*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    });
  });

  test('collapses duplicate redirects and keeps the first rule', () => {
    const manifest = buildCloudflareWorkersManifest({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [
        { from: '/dup', to: '/first', status: 301, force: false },
        { from: '/dup', to: '/second', status: 302, force: false },
      ],
    });

    expect(manifest.redirects).toEqual([{ source: '/dup', destination: '/first', status: 301 }]);
  });
});

describe('emitCloudflareWorkersManifest', () => {
  test('does not emit _routes-manifest.json when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflareWorkersManifest({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
    });

    expect(existsSync(join(outputDir, '_routes-manifest.json'))).toBe(false);
  });

  test('writes _routes-manifest.json at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudflareWorkersManifest({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new/', status: 301, force: false }],
    });

    const path = join(outputDir, '_routes-manifest.json');
    expect(existsSync(path)).toBe(true);
    const body = await readFile(path, 'utf8');
    expect(body.endsWith('\n')).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      version: 1,
      redirects: [{ source: '/old', destination: '/new/', status: 301 }],
    });
  });
});
