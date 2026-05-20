import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';
import { absoluteUrl } from './url.ts';

const DEFAULT_DISALLOW_PATHS = [
  '/ghost/',
  '/email/',
  '/members/api/comments/counts/',
  '/r/',
  '/webmentions/receive/',
  '/.ghost/analytics/api/',
];

export async function emitRobots(opts: {
  cwd: string;
  config: NectarConfig;
  outputDir: string;
  theme?: Pick<ThemeBundle, 'rootDir'> | undefined;
}): Promise<void> {
  const { cwd, config, outputDir, theme } = opts;
  await ensureDir(outputDir);

  // `static/robots.txt` is Nectar's site-level escape hatch and still wins over
  // generated output. Ghost themes can also ship a root-level `robots.txt`;
  // when present, copy it verbatim instead of generating the default body.
  const overridePath = join(cwd, 'static', 'robots.txt');
  const overrideFile = Bun.file(overridePath);
  if (await overrideFile.exists()) {
    const overrideBody = await overrideFile.text();
    await writeFile(join(outputDir, 'robots.txt'), overrideBody, 'utf8');
    return;
  }
  if (theme) {
    const themeOverrideFile = Bun.file(join(theme.rootDir, 'robots.txt'));
    if (await themeOverrideFile.exists()) {
      const overrideBody = await themeOverrideFile.text();
      await writeFile(join(outputDir, 'robots.txt'), overrideBody, 'utf8');
      return;
    }
  }

  const sitemapUrl = absoluteUrl('sitemap.xml', config);
  const lines = config.components.robots.disallow
    ? ['User-agent: *', 'Disallow: /']
    : [
        'User-agent: *',
        `Sitemap: ${sitemapUrl}`,
        ...DEFAULT_DISALLOW_PATHS.map((path) => `Disallow: ${path}`),
      ];
  const body = `${lines.join('\n')}\n`;
  await writeFile(join(outputDir, 'robots.txt'), body, 'utf8');
}
