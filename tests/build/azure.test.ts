import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStaticWebAppConfig, emitAzureStaticWebAppConfig } from '~/build/azure.ts';

describe('azure staticwebapp.config.json', () => {
  test('navigationFallback rewrites to the themed 404 page', () => {
    const cfg = buildStaticWebAppConfig();
    expect(cfg.navigationFallback.rewrite).toBe('/404.html');
  });

  test('navigationFallback excludes fingerprinted asset paths', () => {
    const cfg = buildStaticWebAppConfig();
    expect(cfg.navigationFallback.exclude).toContain('/assets/*');
    expect(cfg.navigationFallback.exclude).toContain('/content/images/*');
  });

  test('grants anonymous access to /api/*', () => {
    const cfg = buildStaticWebAppConfig();
    const apiRoute = cfg.routes.find((r) => r.route === '/api/*');
    expect(apiRoute).toBeDefined();
    expect(apiRoute?.allowedRoles).toEqual(['anonymous']);
  });

  test('emits the config as JSON with a trailing newline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-azure-'));
    try {
      await emitAzureStaticWebAppConfig({ outputDir: dir });
      const body = await readFile(join(dir, 'staticwebapp.config.json'), 'utf8');
      expect(body.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(body);
      expect(parsed.navigationFallback.rewrite).toBe('/404.html');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
