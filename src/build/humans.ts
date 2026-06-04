import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';

export async function emitHumans(opts: {
  cwd: string;
  config: LaurelConfig;
  outputDir: string;
}): Promise<void> {
  const { cwd, config, outputDir } = opts;
  await ensureDir(outputDir);
  const overridePath = join(cwd, 'static', 'humans.txt');
  const overrideFile = Bun.file(overridePath);
  if (await overrideFile.exists()) {
    const overrideBody = await overrideFile.text();
    await writeFile(join(outputDir, 'humans.txt'), overrideBody, 'utf8');
    return;
  }

  const lines = ['/* SITE */', `Title: ${config.site.title}`];
  if (config.site.description) {
    lines.push(`Description: ${config.site.description}`);
  }
  lines.push(`URL: ${config.site.url}`, 'Generator: Laurel');

  await writeFile(join(outputDir, 'humans.txt'), `${lines.join('\n')}\n`, 'utf8');
}
