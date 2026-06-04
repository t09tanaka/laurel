import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FEDIVERSE_DISCOVERY_PATH,
  buildFediverseDiscovery,
  emitFediverseDiscovery,
} from '~/build/fediverse.ts';
import type { LaurelConfig } from '~/config/schema.ts';

function makeConfig(): LaurelConfig {
  return {
    site: { url: 'https://example.com' },
  } as unknown as LaurelConfig;
}

describe('fediverse discovery', () => {
  test('documents static ActivityPub and WebFinger non-support', () => {
    const discovery = buildFediverseDiscovery(makeConfig());

    expect(discovery.site_url).toBe('https://example.com');
    expect(discovery.activitypub.supported).toBe(false);
    expect(discovery.webfinger.supported).toBe(false);
    expect(discovery.webfinger.reason).toContain('query-aware');
  });

  test('emits the .well-known non-support artifact', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'laurel-fediverse-'));
    try {
      await emitFediverseDiscovery({ config: makeConfig(), outputDir });

      const body = JSON.parse(await readFile(join(outputDir, FEDIVERSE_DISCOVERY_PATH), 'utf8'));
      expect(body.schema).toBe('laurel.fediverse.v1');
      expect(body.activitypub.supported).toBe(false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
