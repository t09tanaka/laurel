import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PORTAL_MANIFEST_PATH,
  buildPortalManifest,
  emitPortalManifest,
} from '~/build/portal-manifest.ts';
import type { NectarConfig } from '~/config/schema.ts';

function makeConfig(overrides: Partial<NectarConfig['components']['portal']> = {}): NectarConfig {
  return {
    components: {
      portal: {
        provider: 'buttondown',
        paid: false,
        invite_only: false,
        ...overrides,
      },
    },
  } as unknown as NectarConfig;
}

describe('portal manifest', () => {
  test('lists configured portal rewrite selectors and fallback warning selectors', () => {
    const manifest = buildPortalManifest({
      config: makeConfig(),
      urls: { signup: 'https://buttondown.email/example' },
      recommendationsEnabled: true,
    });

    expect(manifest.provider).toBe('buttondown');
    expect(manifest.selectors).toContainEqual({
      selector: '[data-portal="signup"]',
      action: 'signup',
      behavior: 'rewrite',
      href: 'https://buttondown.email/example',
    });
    expect(manifest.selectors).toContainEqual({
      selector: '[data-portal="signin"]',
      action: 'signin',
      behavior: 'runtime-warning',
    });
    expect(manifest.selectors.some((s) => s.selector === '[data-portal="recommendations"]')).toBe(
      true,
    );
  });

  test('records invite-only removals', () => {
    const manifest = buildPortalManifest({
      config: makeConfig({ invite_only: true }),
      urls: {},
      recommendationsEnabled: false,
    });

    expect(manifest.selectors).toContainEqual({
      selector: '[data-members-form]',
      action: 'hide-inline-member-forms',
      behavior: 'remove-invite-only',
    });
  });

  test('emits .nectar/portal-manifest.json', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-portal-manifest-'));
    try {
      await emitPortalManifest({
        config: makeConfig(),
        outputDir,
        urls: { account: 'https://example.com/account' },
        recommendationsEnabled: false,
      });

      const body = JSON.parse(await readFile(join(outputDir, PORTAL_MANIFEST_PATH), 'utf8'));
      expect(body.schema).toBe('nectar.portal-manifest.v1');
      expect(body.selectors).toContainEqual({
        selector: '[data-portal="account"]',
        action: 'account',
        behavior: 'rewrite',
        href: 'https://example.com/account',
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
