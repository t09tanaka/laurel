import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitTierWelcomePages } from '~/build/tier-welcome-pages.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { Tier } from '~/content/model.ts';

function makeConfig(overrides: Partial<NectarConfig> = {}): NectarConfig {
  return {
    site: {
      title: 'Example',
      description: 'Static membership site',
      url: 'https://example.com',
      locale: 'en',
    },
    build: { base_path: '/', output_dir: 'dist' },
    ...overrides,
  } as unknown as NectarConfig;
}

function makeTier(overrides: Partial<Tier> = {}): Tier {
  return {
    id: 'tier_free',
    slug: 'free',
    name: 'Free',
    description: 'Free member updates.',
    type: 'free',
    active: true,
    visibility: 'public',
    trial_days: 0,
    monthly_price: undefined,
    yearly_price: undefined,
    currency: undefined,
    welcome_page_url: undefined,
    benefits: [],
    ...overrides,
  };
}

describe('emitTierWelcomePages', () => {
  test('emits a default free-tier welcome page', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-tier-welcome-'));
    try {
      const emitted = await emitTierWelcomePages({
        config: makeConfig(),
        outputDir,
        tiers: [makeTier()],
      });

      expect(emitted).toEqual(['welcome/free/index.html']);
      const html = await readFile(join(outputDir, 'welcome/free/index.html'), 'utf8');
      expect(html).toContain('<title>Free welcome | Example</title>');
      expect(html).toContain('<link rel="canonical" href="https://example.com/welcome/free/">');
      expect(html).toContain('data-portal="account"');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test('honours safe root-relative welcome_page_url and skips reserved routes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-tier-welcome-'));
    try {
      const emitted = await emitTierWelcomePages({
        config: makeConfig({ build: { base_path: '/blog/', output_dir: 'dist' } } as NectarConfig),
        outputDir,
        tiers: [makeTier({ slug: 'supporter', welcome_page_url: '/members/welcome' })],
        reservedOutputPaths: new Set(['welcome/free/index.html']),
      });

      expect(emitted).toEqual(['members/welcome/index.html']);
      const html = await readFile(join(outputDir, 'members/welcome/index.html'), 'utf8');
      expect(html).toContain('https://example.com/blog/members/welcome/');
      expect(html).toContain('href="/blog/#/portal/account"');
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test('does not emit external, unsafe, or route-owned welcome pages', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'nectar-tier-welcome-'));
    try {
      const emitted = await emitTierWelcomePages({
        config: makeConfig(),
        outputDir,
        tiers: [
          makeTier({ welcome_page_url: 'https://checkout.example/free' }),
          makeTier({ slug: 'escape', welcome_page_url: '/../escape' }),
          makeTier({ slug: 'owned' }),
        ],
        reservedOutputPaths: new Set(['welcome/owned/index.html']),
      });

      expect(emitted).toEqual([]);
      expect(existsSync(join(outputDir, 'welcome/owned/index.html'))).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
