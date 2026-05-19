import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// GitHub Pages runs Jekyll by default, which strips files and directories whose
// names start with an underscore (e.g. `_next/`, `_normalize.css`). Emitting an
// empty `.nojekyll` at the site root disables that behavior so every emitted
// file is served verbatim.
export async function emitNojekyll(opts: { outputDir: string }): Promise<void> {
  const { outputDir } = opts;
  await ensureDir(outputDir);
  await writeFile(join(outputDir, '.nojekyll'), '');
}
