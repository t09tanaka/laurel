import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';

export async function emitRobots(opts: {
  config: NectarConfig;
  outputDir: string;
}): Promise<void> {
  const { config, outputDir } = opts;
  const base = config.site.url.replace(/\/$/, '');
  const lines = config.components.robots.disallow
    ? ['User-agent: *', 'Disallow: /']
    : ['User-agent: *', 'Allow: /', `Sitemap: ${base}/sitemap.xml`];
  const body = `${lines.join('\n')}\n`;
  await ensureDir(outputDir);
  await writeFile(join(outputDir, 'robots.txt'), body, 'utf8');
}
