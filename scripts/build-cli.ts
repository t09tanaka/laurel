#!/usr/bin/env bun
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type PackageJson = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
];
const outdir = process.env.LAUREL_BUILD_OUTDIR?.trim() || 'dist';

const entries: Array<{ entrypoint: string; outName: string; bin?: true }> = [
  { entrypoint: 'src/cli/index.ts', outName: 'cli.mjs', bin: true },
  { entrypoint: 'src/build/index.ts', outName: 'build.mjs' },
  { entrypoint: 'src/types.ts', outName: 'types.mjs' },
  { entrypoint: 'src/plugin/index.ts', outName: 'plugin.mjs' },
];

for (const { entrypoint, outName, bin } of entries) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: 'bun',
    format: 'esm',
    naming: { entry: outName },
    external,
    sourcemap: 'external',
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  if (bin) {
    // npm sets the mode during `npm install`, but we want `node dist/cli.mjs`
    // / `./dist/cli.mjs` to work right after a local `bun run build:cli`.
    await chmod(join(outdir, outName), 0o755);
  }

  console.log(
    `Built ${join(outdir, outName)} (${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'})`,
  );
}
