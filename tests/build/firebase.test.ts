import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFirebaseConfig,
  buildFirebaseHeaders,
  buildFirebaseRedirects,
  emitFirebaseJson,
  toFirebaseSource,
} from '~/build/firebase.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-firebase-'));
}

const DEFAULT_HEADERS_CONFIG = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

describe('toFirebaseSource', () => {
  test('translates root catch-all patterns to Firebase recursive globs', () => {
    expect(toFirebaseSource('/*')).toBe('**');
  });

  test('translates subtree wildcards to Firebase recursive globs', () => {
    expect(toFirebaseSource('/assets/*')).toBe('/assets/**');
    expect(toFirebaseSource('/old/*')).toBe('/old/**');
  });

  test('keeps exact paths unchanged', () => {
    expect(toFirebaseSource('/old')).toBe('/old');
  });
});

describe('buildFirebaseHeaders', () => {
  test('maps deploy headers into Firebase Hosting header rules', () => {
    const rules = buildFirebaseHeaders(DEFAULT_HEADERS_CONFIG);

    expect(rules).toContainEqual(
      expect.objectContaining({
        source: '/assets/**',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      }),
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        source: '**',
        headers: expect.arrayContaining([
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ]),
      }),
    );
  });
});

describe('buildFirebaseRedirects', () => {
  test('maps canonical redirects to Firebase Hosting redirect rules', () => {
    const rules = buildFirebaseRedirects([
      { from: '/old', to: '/new', status: 301, force: false },
      { from: '/legacy/*', to: '/new', status: 308, force: true },
    ]);

    expect(rules).toEqual([
      { source: '/old', destination: '/new', type: 301 },
      { source: '/legacy/**', destination: '/new', type: 308 },
    ]);
  });

  test('collapses duplicate sources and keeps the first rule', () => {
    const rules = buildFirebaseRedirects([
      { from: '/dup', to: '/first', status: 301, force: true },
      { from: '/dup', to: '/second', status: 302, force: false },
    ]);

    expect(rules).toEqual([{ source: '/dup', destination: '/first', type: 301 }]);
  });
});

describe('buildFirebaseConfig', () => {
  test('folds shared deploy config into a single hosting object', () => {
    const config = buildFirebaseConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      trailingSlash: 'always',
    });

    expect(config.hosting.public).toBe('.');
    expect(config.hosting.ignore).toEqual(['firebase.json', '**/.*', '**/node_modules/**']);
    expect(config.hosting.cleanUrls).toBe(true);
    expect(config.hosting.trailingSlash).toBe(true);
    expect(config.hosting.headers).toBeDefined();
    expect(config.hosting.redirects).toEqual([{ source: '/old', destination: '/new', type: 301 }]);
    expect(config.hosting.rewrites).toEqual([]);
  });

  test('sets trailingSlash false for never-slash builds', () => {
    const config = buildFirebaseConfig({
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'never',
    });

    expect(config.hosting.trailingSlash).toBe(false);
  });
});

describe('emitFirebaseJson', () => {
  test('does not emit firebase.json when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitFirebaseJson({
      outputDir,
      enabled: false,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });

    expect(existsSync(join(outputDir, 'firebase.json'))).toBe(false);
  });

  test('writes firebase.json at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitFirebaseJson({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [],
      trailingSlash: 'always',
    });

    expect(existsSync(join(outputDir, 'firebase.json'))).toBe(true);
  });

  test('produces valid JSON terminated with a trailing newline', async () => {
    const outputDir = await makeOutputDir();

    await emitFirebaseJson({
      outputDir,
      enabled: true,
      headers: DEFAULT_HEADERS_CONFIG,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      trailingSlash: 'always',
    });

    const body = await readFile(join(outputDir, 'firebase.json'), 'utf8');
    expect(body.endsWith('\n')).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      hosting: {
        public: '.',
        cleanUrls: true,
        redirects: [{ source: '/old', destination: '/new', type: 301 }],
      },
    });
  });
});
