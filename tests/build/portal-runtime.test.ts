import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PORTAL_RUNTIME_JS,
  PORTAL_RUNTIME_PATH,
  emitPortalRuntime,
  renderPortalRuntimeConfig,
} from '~/build/portal-runtime.ts';

function tmpDir(): string {
  return join(
    process.env.TMPDIR ?? '/tmp',
    `nectar-portal-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}

describe('emitPortalRuntime', () => {
  let outputDir = '';

  beforeEach(() => {
    outputDir = tmpDir();
  });

  afterEach(async () => {
    await Bun.$`rm -rf ${outputDir}`.quiet().nothrow();
  });

  test('writes assets/nectar-portal.js when members are enabled', async () => {
    const wrote = await emitPortalRuntime({ outputDir, enabled: true });

    expect(wrote).toBe(true);
    const dest = join(outputDir, PORTAL_RUNTIME_PATH);
    expect(existsSync(dest)).toBe(true);
    expect(await readFile(dest, 'utf8')).toBe(PORTAL_RUNTIME_JS);
  });

  test('does not write the runtime when members are disabled', async () => {
    const wrote = await emitPortalRuntime({ outputDir, enabled: false });

    expect(wrote).toBe(false);
    expect(existsSync(join(outputDir, PORTAL_RUNTIME_PATH))).toBe(false);
  });
});

describe('PORTAL_RUNTIME_JS', () => {
  test('binds the Ghost data-portal contract including static stubs', () => {
    expect(PORTAL_RUNTIME_JS).toContain("closest('[data-portal]')");
    expect(PORTAL_RUNTIME_JS).toContain("rawAction === 'subscribe' ? 'signup'");
    expect(PORTAL_RUNTIME_JS).toContain('signup');
    expect(PORTAL_RUNTIME_JS).toContain('signin');
    expect(PORTAL_RUNTIME_JS).toContain('account');
    expect(PORTAL_RUNTIME_JS).toContain('upgrade');
    expect(PORTAL_RUNTIME_JS).toContain('recommendations');
    expect(PORTAL_RUNTIME_JS).toContain('console.warn');
  });

  test('offers a cancelable custom-provider event before fallback navigation', () => {
    expect(PORTAL_RUNTIME_JS).toContain("'nectar:portal'");
    expect(PORTAL_RUNTIME_JS).toContain('cancelable: true');
    expect(PORTAL_RUNTIME_JS).toContain('preventDefault');
  });
});

describe('renderPortalRuntimeConfig', () => {
  test('serializes resolved provider URLs and recommendations target', () => {
    const out = renderPortalRuntimeConfig({
      basePath: '/blog/',
      recommendationsEnabled: true,
      portalUrls: {
        signup: 'https://buttondown.email/news',
        signin: 'https://buttondown.email/login',
        account: 'https://buttondown.email/account',
        upgrade: 'https://example.test/upgrade',
      },
    });

    expect(JSON.parse(out)).toEqual({
      actions: {
        signup: 'https://buttondown.email/news',
        signin: 'https://buttondown.email/login',
        account: 'https://buttondown.email/account',
        upgrade: 'https://example.test/upgrade',
        recommendations: '/blog/recommendations/#all-recommendations',
      },
    });
  });

  test('keeps missing provider URLs as runtime warning stubs', () => {
    expect(
      JSON.parse(
        renderPortalRuntimeConfig({
          basePath: '/',
          recommendationsEnabled: false,
          portalUrls: {},
        }),
      ),
    ).toEqual({ actions: {} });
  });
});
