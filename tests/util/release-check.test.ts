import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLatestRelease, formatReleaseCheck } from '~/util/release-check.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-release-check-'));
  tempDirs.push(dir);
  return join(dir, 'release.json');
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('release check', () => {
  test('NECTAR_NO_UPDATE_CHECK disables fetch and cache reads', async () => {
    const cachePath = await tempCachePath();
    let calls = 0;
    const result = await checkLatestRelease({
      currentVersion: '1.0.0',
      cachePath,
      env: { NECTAR_NO_UPDATE_CHECK: '1' },
      fetchFn: async () => {
        calls += 1;
        return jsonResponse({ version: '9.9.9' });
      },
    });

    expect(result.status).toBe('disabled');
    expect(result.cached).toBe(false);
    expect(calls).toBe(0);
    expect(formatReleaseCheck(result)).toContain('Update check disabled');
  });

  test('fetches npm latest release and caches it', async () => {
    const cachePath = await tempCachePath();
    const result = await checkLatestRelease({
      currentVersion: '1.0.0',
      cachePath,
      env: {},
      fetchFn: async (url) => {
        expect(String(url)).toBe('https://registry.npmjs.org/nectar/latest');
        return jsonResponse({ version: '1.2.0' });
      },
    });

    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('1.2.0');
    expect(result.source).toBe('npm');
    expect(result.cached).toBe(false);
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toMatchObject({
      schema: 1,
      latestVersion: '1.2.0',
      source: 'npm',
    });
  });

  test('uses a one-day cache without calling fetch', async () => {
    const cachePath = await tempCachePath();
    await writeFile(
      cachePath,
      JSON.stringify({
        schema: 1,
        fetchedAt: '2026-05-20T00:00:00.000Z',
        latestVersion: '1.2.0',
        source: 'npm',
      }),
      'utf8',
    );

    let calls = 0;
    const result = await checkLatestRelease({
      currentVersion: '1.2.0',
      cachePath,
      env: {},
      now: () => new Date('2026-05-20T23:59:59.000Z'),
      fetchFn: async () => {
        calls += 1;
        return jsonResponse({ version: '9.9.9' });
      },
    });

    expect(calls).toBe(0);
    expect(result.status).toBe('up-to-date');
    expect(result.cached).toBe(true);
    expect(formatReleaseCheck(result)).toContain('Latest release: 1.2.0 (npm, cached)');
  });

  test('falls back to GitHub latest release when npm has no usable version', async () => {
    const cachePath = await tempCachePath();
    const urls: string[] = [];
    const result = await checkLatestRelease({
      currentVersion: '1.0.0',
      cachePath,
      env: {},
      fetchFn: async (url) => {
        urls.push(String(url));
        return urls.length === 1
          ? jsonResponse({}, { status: 404 })
          : jsonResponse({ tag_name: 'v1.0.1' });
      },
    });

    expect(urls).toEqual([
      'https://registry.npmjs.org/nectar/latest',
      'https://api.github.com/repos/t09tanaka/nectar/releases/latest',
    ]);
    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('1.0.1');
    expect(result.source).toBe('github');
  });

  test('reports unknown when release metadata cannot be fetched', async () => {
    const cachePath = await tempCachePath();
    const result = await checkLatestRelease({
      currentVersion: '1.0.0',
      cachePath,
      env: {},
      fetchFn: async () => {
        throw new Error('offline');
      },
    });

    expect(result.status).toBe('unknown');
    expect(result.latestVersion).toBeUndefined();
    expect(formatReleaseCheck(result)).toContain('Unable to check for updates');
  });
});
