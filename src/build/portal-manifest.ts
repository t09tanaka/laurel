import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import { joinPath } from '~/theme/assets.ts';
import { ensureDir } from '~/util/fs.ts';
import type { PortalTrigger, ResolvedPortalUrls } from './portal-urls.ts';

export const PORTAL_MANIFEST_PATH = '.laurel/portal-manifest.json';

type PortalManifestBehavior = 'rewrite' | 'remove-invite-only' | 'runtime-warning' | 'deep-link';

interface PortalManifestSelector {
  selector: string;
  action: string;
  behavior: PortalManifestBehavior;
  href?: string;
}

interface PortalManifest {
  schema: 'laurel.portal-manifest.v1';
  provider: LaurelConfig['components']['portal']['provider'];
  invite_only: boolean;
  selectors: PortalManifestSelector[];
}

const PORTAL_TRIGGERS: readonly PortalTrigger[] = ['signup', 'signin', 'account', 'upgrade'];

export function buildPortalManifest(opts: {
  config: LaurelConfig;
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
      href: `${joinPath(opts.config.build.base_path, 'recommendations/')}#all-recommendations`,
    });
  }
  return {
    schema: 'laurel.portal-manifest.v1',
    provider: opts.config.components.portal.provider,
    invite_only: opts.config.components.portal.invite_only,
    selectors,
  };
}

export async function emitPortalManifest(opts: {
  config: LaurelConfig;
  outputDir: string;
  urls: ResolvedPortalUrls;
  recommendationsEnabled: boolean;
}): Promise<void> {
  const dest = join(opts.outputDir, PORTAL_MANIFEST_PATH);
  await ensureDir(join(opts.outputDir, '.laurel'));
  await writeFile(dest, `${JSON.stringify(buildPortalManifest(opts), null, 2)}\n`, 'utf8');
}
