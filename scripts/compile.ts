#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';

type Target = {
  triple: string;
  bunTarget: string;
  outfile: string;
};

const TARGETS: ReadonlyArray<Target> = [
  { triple: 'linux-x64', bunTarget: 'bun-linux-x64', outfile: 'nectar-linux-x64' },
  { triple: 'linux-arm64', bunTarget: 'bun-linux-arm64', outfile: 'nectar-linux-arm64' },
  { triple: 'darwin-x64', bunTarget: 'bun-darwin-x64', outfile: 'nectar-darwin-x64' },
  { triple: 'darwin-arm64', bunTarget: 'bun-darwin-arm64', outfile: 'nectar-darwin-arm64' },
  { triple: 'windows-x64', bunTarget: 'bun-windows-x64', outfile: 'nectar-windows-x64.exe' },
];

function resolveHostTriple(): string {
  const platform = process.platform;
  const arch = process.arch;
  const platformPart =
    platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : null;
  const archPart = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!platformPart || !archPart) {
    throw new Error(`Unsupported host platform/arch combination: ${platform}/${arch}`);
  }
  return `${platformPart}-${archPart}`;
}

function selectTargets(argv: string[]): Target[] {
  if (argv.includes('--all')) {
    return [...TARGETS];
  }
  const explicit = argv.find((arg) => arg.startsWith('--target='))?.slice('--target='.length);
  if (explicit) {
    const match = TARGETS.find((t) => t.triple === explicit || t.bunTarget === explicit);
    if (!match) {
      const known = TARGETS.map((t) => t.triple).join(', ');
      throw new Error(`Unknown --target=${explicit}. Known: ${known}`);
    }
    return [match];
  }
  const host = resolveHostTriple();
  const match = TARGETS.find((t) => t.triple === host);
  if (!match) {
    throw new Error(`No precompiled target matches host triple ${host}.`);
  }
  return [match];
}

async function compileOne(target: Target, outDir: string): Promise<void> {
  const outfile = `${outDir}/${target.outfile}`;
  const proc = Bun.spawn(
    [
      'bun',
      'build',
      '--compile',
      '--minify',
      '--sourcemap',
      `--target=${target.bunTarget}`,
      `--outfile=${outfile}`,
      'src/cli/index.ts',
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`bun build --compile failed for ${target.bunTarget} (exit ${code})`);
  }
  console.log(`Built ${outfile}`);
}

const argv = process.argv.slice(2);
const outDir = 'dist-bin';
await mkdir(outDir, { recursive: true });

const targets = selectTargets(argv);
for (const target of targets) {
  await compileOne(target, outDir);
}
