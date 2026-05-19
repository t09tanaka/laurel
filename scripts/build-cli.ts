#!/usr/bin/env bun
import { chmod, readFile } from 'node:fs/promises';

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

const entries: Array<{ entrypoint: string; outName: string; bin?: true }> = [
  { entrypoint: 'src/cli/index.ts', outName: 'cli.mjs', bin: true },
  { entrypoint: 'src/build/index.ts', outName: 'build.mjs' },
];

for (const { entrypoint, outName, bin } of entries) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: 'dist',
    target: 'bun',
    format: 'esm',
    naming: { entry: outName },
    external,
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
    await chmod(`dist/${outName}`, 0o755);
  }

  console.log(`Built dist/${outName} (${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'})`);
}
