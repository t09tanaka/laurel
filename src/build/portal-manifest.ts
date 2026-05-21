import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';
import type { PortalTrigger, ResolvedPortalUrls } from './portal-urls.ts';

export const PORTAL_MANIFEST_PATH = '.nectar/portal-manifest.json';

type PortalManifestBehavior = 'rewrite' | 'remove-invite-only' | 'runtime-warning' | 'deep-link';

export interface PortalManifestSelector {
  selector: string;
  action: string;
  behavior: PortalManifestBehavior;
  href?: string;
}

export interface PortalManifest {
  schema: 'nectar.portal-manifest.v1';
  provider: NectarConfig['components']['portal']['provider'];
  invite_only: boolean;
  selectors: PortalManifestSelector[];
}

const PORTAL_TRIGGERS: readonly PortalTrigger[] = ['signup', 'signin', 'account', 'upgrade'];

export function buildPortalManifest(opts: {
  config: NectarConfig;
  urls: ResolvedPortalUrls;
  recommendationsEnabled: boolean;
}): PortalManifest {
  const selectors: PortalManifestSelector[] = [];
  for (const trigger of PORTAL_TRIGGERS) {
    const href = opts.urls[trigger];
    selectors.push({
      selector: `[data-portal="${trigger}"]`,
      action: trigger,
      behavior: href ? 'rewrite' : 'runtime-warning',
      ...(href ? { href } : {}),
    });
  }
  if (opts.config.components.portal.invite_only) {
    selectors.push(
      {
        selector: '[data-portal="signup"], [data-portal="subscribe"]',
        action: 'hide-public-signup',
        behavior: 'remove-invite-only',
      },
      {
        selector: '[data-members-form]',
        action: 'hide-inline-member-forms',
        behavior: 'remove-invite-only',
      },
    );
  }
  if (opts.recommendationsEnabled) {
    selectors.push({
      selector: '[data-portal="recommendations"]',
      action: 'recommendations',
      behavior: 'deep-link',
      href: '/recommendations/#all-recommendations',
    });
  }
  return {
    schema: 'nectar.portal-manifest.v1',
    provider: opts.config.components.portal.provider,
    invite_only: opts.config.components.portal.invite_only,
    selectors,
  };
}

export async function emitPortalManifest(opts: {
  config: NectarConfig;
  outputDir: string;
  urls: ResolvedPortalUrls;
  recommendationsEnabled: boolean;
}): Promise<void> {
  const dest = join(opts.outputDir, PORTAL_MANIFEST_PATH);
  await ensureDir(join(opts.outputDir, '.nectar'));
  await writeFile(dest, `${JSON.stringify(buildPortalManifest(opts), null, 2)}\n`, 'utf8');
}
