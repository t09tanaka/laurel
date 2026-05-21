import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';

export const FEDIVERSE_DISCOVERY_PATH = '.well-known/nectar-fediverse.json';

export interface FediverseDiscovery {
  schema: 'nectar.fediverse.v1';
  site_url: string;
  activitypub: {
    supported: false;
    reason: string;
  };
  webfinger: {
    supported: false;
    reason: string;
    static_passthrough: string;
  };
}

export function buildFediverseDiscovery(config: NectarConfig): FediverseDiscovery {
  return {
    schema: 'nectar.fediverse.v1',
    site_url: config.site.url,
    activitypub: {
      supported: false,
      reason:
        'Nectar emits static files only and does not implement ActivityPub actors, inboxes, outboxes, signatures, or delivery.',
    },
    webfinger: {
      supported: false,
      reason:
        'WebFinger requires query-aware responses such as /.well-known/webfinger?resource=acct:user@example.com; static hosts cannot vary this generated file by query string.',
      static_passthrough:
        'Place a hand-written .well-known/webfinger file under the configured static directory only when your host can serve the exact resource you need.',
    },
  };
}

export async function emitFediverseDiscovery(opts: {
  config: NectarConfig;
  outputDir: string;
}): Promise<void> {
  const dest = join(opts.outputDir, FEDIVERSE_DISCOVERY_PATH);
  await ensureDir(join(opts.outputDir, '.well-known'));
  await writeFile(
    dest,
    `${JSON.stringify(buildFediverseDiscovery(opts.config), null, 2)}\n`,
    'utf8',
  );
}
