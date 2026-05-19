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

const result = await Bun.build({
  entrypoints: ['src/cli/index.ts'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  naming: { entry: 'cli.mjs' },
  external,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Ensure the bin entry is executable for local invocation. npm sets the mode
// during `npm install`, but we want `node dist/cli.mjs` / `./dist/cli.mjs` to
// work right after `bun run build:cli`.
await chmod('dist/cli.mjs', 0o755);

console.log(`Built dist/cli.mjs (${result.outputs.length} output${result.outputs.length === 1 ? '' : 's'})`);
