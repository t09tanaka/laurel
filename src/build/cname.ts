import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';

// GitHub Pages binds a custom domain by reading a `CNAME` file at the
// publishing-source root. The file must contain exactly the host with no
// surrounding whitespace and no trailing newline — extra bytes confuse the
// Pages domain validator and silently break the binding.
export async function emitCname(opts: {
  outputDir: string;
  customDomain: string | undefined;
}): Promise<void> {
  const host = opts.customDomain?.trim();
  if (!host) return;
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, 'CNAME'), host);
}
