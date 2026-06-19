import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PORTAL_MANIFEST_PATH,
  buildPortalManifest,
  emitPortalManifest,
} from '~/build/portal-manifest.ts';
import type { LaurelConfig } from '~/config/schema.ts';

function makeConfig(
  overrides: Partial<LaurelConfig['components']['portal']> = {},
  basePath = '/',
): LaurelConfig {
  return {
    build: { base_path: basePath },
    components: {
      portal: {
        provider: 'buttondown',
        paid: false,
        invite_only: false,
        ...overrides,
      },
    },
  } as unknown as LaurelConfig;
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

  test('recommendations deep-link href carries base_path', () => {
    const root = buildPortalManifest({
      config: makeConfig(),
      urls: {},
      recommendationsEnabled: true,
    });
    expect(root.selectors).toContainEqual({
      selector: '[data-portal="recommendations"]',
      action: 'recommendations',
      behavior: 'deep-link',
      href: '/recommendations/#all-recommendations',
    });

    const subpath = buildPortalManifest({
      config: makeConfig({}, '/blog/'),
      urls: {},
      recommendationsEnabled: true,
    });
    expect(subpath.selectors).toContainEqual({
      selector: '[data-portal="recommendations"]',
      action: 'recommendations',
      behavior: 'deep-link',
      href: '/blog/recommendations/#all-recommendations',
    });
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

  test('emits .laurel/portal-manifest.json', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'laurel-portal-manifest-'));
    try {
      await emitPortalManifest({
        config: makeConfig(),
        outputDir,
        urls: { account: 'https://example.com/account' },
        recommendationsEnabled: false,
      });

      const body = JSON.parse(await readFile(join(outputDir, PORTAL_MANIFEST_PATH), 'utf8'));
      expect(body.schema).toBe('laurel.portal-manifest.v1');
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
