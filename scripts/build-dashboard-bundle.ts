#!/usr/bin/env bun
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const outdir = process.env.NECTAR_BUILD_OUTDIR?.trim() || 'dist';
const bundleDir = join(outdir, 'dashboard-bundle');
await mkdir(bundleDir, { recursive: true });

const jsResult = await Bun.build({
  entrypoints: ['src/cli/dashboard/web/entry.tsx'],
  outdir: bundleDir,
  target: 'browser',
  format: 'esm',
  naming: { entry: 'dashboard.js' },
  minify: true,
  sourcemap: 'none',
});

if (!jsResult.success) {
  for (const log of jsResult.logs) console.error(log);
  process.exit(1);
}

await copyFile(
  'src/cli/dashboard/web/styles.css',
  join(bundleDir, 'dashboard.css'),
);

const sizes = await Promise.all(
  ['dashboard.js', 'dashboard.css'].map(async (name) => {
    const info = await stat(join(bundleDir, name));
    return `${name}: ${info.size} B`;
  }),
);
console.log(`Built ${bundleDir}/ — ${sizes.join(', ')}`);
