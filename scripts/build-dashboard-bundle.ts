#!/usr/bin/env bun
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

const cssIn = resolve('src/cli/dashboard/web/styles.css');
const cssOut = resolve(bundleDir, 'dashboard.css');
const tailwindBin = resolve('node_modules/.bin/tailwindcss');

const css = Bun.spawn([tailwindBin, '--input', cssIn, '--output', cssOut, '--minify'], {
  stdout: 'pipe',
  stderr: 'pipe',
});
const cssExit = await css.exited;
if (cssExit !== 0) {
  const errText = await new Response(css.stderr).text();
  console.error(errText.trim());
  process.exit(cssExit);
}

const sizes = await Promise.all(
  ['dashboard.js', 'dashboard.css'].map(async (name) => {
    const info = await stat(join(bundleDir, name));
    return `${name}: ${info.size} B`;
  }),
);
console.log(`Built ${bundleDir}/ — ${sizes.join(', ')}`);
