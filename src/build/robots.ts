import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';
import { absoluteUrl } from './url.ts';

// Operators with site-specific crawler rules (per-bot Disallow, multiple
// Sitemap entries, AI bot allow/deny lists) drop a hand-authored
// `static/robots.txt` at the project root and Nectar copies it verbatim
// instead of generating the default body. The override wins over both the
// default Allow body and the `components.robots.disallow` staging shortcut so
// the file on disk is the single source of truth when present.
export async function emitRobots(opts: {
  cwd: string;
  config: NectarConfig;
  outputDir: string;
}): Promise<void> {
  const { cwd, config, outputDir } = opts;
  await ensureDir(outputDir);
  const overridePath = join(cwd, 'static', 'robots.txt');
  const overrideFile = Bun.file(overridePath);
  if (await overrideFile.exists()) {
    const overrideBody = await overrideFile.text();
    await writeFile(join(outputDir, 'robots.txt'), overrideBody, 'utf8');
    return;
  }
  const sitemapUrl = absoluteUrl('sitemap.xml', config);
  const lines = config.components.robots.disallow
    ? ['User-agent: *', 'Disallow: /']
    : ['User-agent: *', 'Allow: /', `Sitemap: ${sitemapUrl}`];
  const body = `${lines.join('\n')}\n`;
  await writeFile(join(outputDir, 'robots.txt'), body, 'utf8');
}
