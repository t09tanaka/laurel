import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloudflareRoutes, emitCloudflareRoutes } from '~/build/cloudflare-routes.ts';

describe('cloudflare _routes.json', () => {
  test('emits version 1, include /*, empty exclude', () => {
    const cfg = buildCloudflareRoutes();
    expect(cfg.version).toBe(1);
    expect(cfg.include).toEqual(['/*']);
    expect(cfg.exclude).toEqual([]);
  });

  test('writes _routes.json when enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-cf-routes-'));
    try {
      await emitCloudflareRoutes({ outputDir: dir, enabled: true });
      const body = await readFile(join(dir, '_routes.json'), 'utf8');
      const parsed = JSON.parse(body);
      expect(parsed).toEqual({ version: 1, include: ['/*'], exclude: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips emission when disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-cf-routes-'));
    try {
      await emitCloudflareRoutes({ outputDir: dir, enabled: false });
      const path = join(dir, '_routes.json');
      const file = Bun.file(path);
      expect(await file.exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
