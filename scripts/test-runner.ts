#!/usr/bin/env bun
// Parallel test shard runner.
//
// `bun test` executes the files it is given sequentially inside one process,
// so a 200s suite stays 200s no matter how many cores the machine has. This
// runner splits the suite into N shards and runs one `bun test <files...>`
// process per shard concurrently, cutting wall-clock to roughly total/N.
//
// Why a custom runner instead of a flag: Bun has no built-in cross-file
// parallelism, and naive sharding is unsafe here because a handful of tests
// write to fixed, in-repo paths (the real `example/dist`, the CLI bundle) and
// would corrupt each other if run concurrently. Those are pinned into one
// shard (see SERIAL_GROUP); every other test isolates under `mkdtemp` and is
// safe to shard freely.
//
// Usage:
//   bun run scripts/test-runner.ts                 # shard the whole suite
//   bun run scripts/test-runner.ts tests/render     # explicit paths -> delegate
//   NECTAR_TEST_SHARDS=6 bun run scripts/test-runner.ts
//
// Any explicit path argument, or a flag that needs a single process
// (--coverage, --watch), bypasses sharding and delegates straight to
// `bun test` so subset runs and coverage stay correct.

import { spawn } from 'bun';

const TEST_GLOB = 'tests/**/*.test.ts';

// Non-hermetic tests: ones that write to a fixed, in-repo path instead of a
// `mkdtemp` sandbox, so two of them running at once corrupt each other's
// output. They are pinned into a single shard and run serially there. Every
// other test isolates under `mkdtemp` and is safe to shard freely, so this
// pinning is what keeps full sharding race-free.
//
//   golden / deploy / example-browser -> build into the real `example/dist`
//   packaging                          -> bundles the CLI into `REPO_ROOT/.nectar/cache`
//
// Keep this list in sync if a new test points `build({ cwd })` / `rm(dist)` at
// the bundled `example/` directory or writes under the repo root.
const SERIAL_GROUP = [
  'tests/render/golden.test.ts',
  'tests/cli/commands/deploy.test.ts',
  'tests/e2e/example-browser.test.ts',
  'tests/packaging.test.ts',
];

// Per-file weights (approx. wall-seconds) used only to balance shards via
// longest-processing-time-first bin packing. They do not affect correctness:
// a wrong weight just yields slightly uneven shards. Only the long-tail-beating
// hot spots (>1s, all child-process / build heavy) are listed; everything else
// is fast and uses DEFAULT_WEIGHT. Re-measure with `--profile` and refresh when
// the suite shifts. The single slowest file is the hard floor on wall-clock,
// since one file cannot be split across shards.
const DEFAULT_WEIGHT = 0.2;
const FILE_WEIGHTS: Record<string, number> = {
  'tests/cli/commands/build.test.ts': 13,
  'tests/e2e/example-browser.test.ts': 8.5,
  'tests/build/pipeline.test.ts': 8,
  'tests/cli/commands/serve.test.ts': 6.5,
  'tests/cli/commands/deploy.test.ts': 5,
  'tests/cli/commands/import-ghost.test.ts': 4.3,
  'tests/cli/commands/content.test.ts': 3.8,
  'tests/cli/dispatch.test.ts': 3.6,
  'tests/packaging.test.ts': 2.9,
  'tests/cli/commands/new.test.ts': 3.2,
  'tests/cli/commands/dev.test.ts': 2.8,
  'tests/cli/commands/check.test.ts': 2.7,
  'tests/build/generate-og-images.test.ts': 2.4,
  'tests/ghost/import.test.ts': 2,
  'tests/cli/help-snapshots.test.ts': 1.9,
  'tests/cli/commands/open.test.ts': 1.7,
  'tests/cli/commands/tags.test.ts': 1.6,
  'tests/cli/commands/export.test.ts': 1.6,
  'tests/cli/commands/theme.test.ts': 1.4,
  'tests/cli/commands/config.test.ts': 1.3,
  'tests/build/feeds.test.ts': 1.2,
  'tests/build/incremental.test.ts': 1.1,
  'tests/cli/commands/dashboard.test.ts': 1,
};

function weightFor(file: string): number {
  return FILE_WEIGHTS[file] ?? DEFAULT_WEIGHT;
}

interface Shard {
  files: string[];
  weight: number;
}

// Longest-processing-time-first: assign each unit (heaviest first) to the
// lightest shard so far. Simple, deterministic, and close to optimal for the
// skewed weight distribution a test suite has.
function packShards(
  units: Array<{ files: string[]; weight: number }>,
  shardCount: number,
): Shard[] {
  const shards: Shard[] = Array.from({ length: shardCount }, () => ({ files: [], weight: 0 }));
  const ordered = [...units].sort((a, b) => b.weight - a.weight);
  for (const unit of ordered) {
    let lightest = shards[0];
    for (const shard of shards) {
      if (shard.weight < lightest.weight) lightest = shard;
    }
    lightest.files.push(...unit.files);
    lightest.weight += unit.weight;
  }
  return shards.filter((shard) => shard.files.length > 0);
}

async function discoverFiles(): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob(TEST_GLOB);
  for await (const file of glob.scan({ cwd: process.cwd() })) {
    files.push(file);
  }
  return files.sort();
}

function buildUnits(files: string[]): Array<{ files: string[]; weight: number }> {
  const grouped = new Set(SERIAL_GROUP);
  const present = SERIAL_GROUP.filter((file) => files.includes(file));
  const units: Array<{ files: string[]; weight: number }> = [];

  if (present.length > 0) {
    units.push({
      files: present,
      weight: present.reduce((sum, file) => sum + weightFor(file), 0),
    });
  }

  for (const file of files) {
    if (grouped.has(file)) continue;
    units.push({ files: [file], weight: weightFor(file) });
  }
  return units;
}

interface ShardResult {
  index: number;
  fileCount: number;
  exitCode: number;
  ms: number;
  output: string;
}

async function runShard(index: number, files: string[], extraArgs: string[]): Promise<ShardResult> {
  const start = performance.now();
  const proc = spawn(['bun', 'test', ...extraArgs, ...files], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    index,
    fileCount: files.length,
    exitCode,
    ms: performance.now() - start,
    // bun test writes its human report to stderr; stdout carries test logs.
    output: stderr + stdout,
  };
}

function isDelegatingArg(arg: string): boolean {
  // Explicit paths or single-process flags bypass sharding.
  if (!arg.startsWith('-')) return true;
  return arg === '--coverage' || arg === '--watch';
}

async function delegateToBunTest(args: string[]): Promise<number> {
  const proc = spawn(['bun', 'test', ...args], { stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const profile = args.includes('--profile');
  const passthrough = args.filter((arg) => arg !== '--profile');

  if (passthrough.some(isDelegatingArg)) {
    return delegateToBunTest(passthrough);
  }

  // Many tests spawn child `bun` processes (CLI integration, full builds), so a
  // shard is not one process but a small process tree. Matching shard count to
  // core count then oversubscribes the CPU and stops paying off past ~6-8 here;
  // it also risks resource exhaustion on high-core machines. Cap at 8 by
  // default and let NECTAR_TEST_SHARDS override for tuning.
  const SHARD_CAP = 8;
  const override = Number(process.env.NECTAR_TEST_SHARDS);
  const shardCount = Math.max(
    1,
    override || Math.min(navigator.hardwareConcurrency || 4, SHARD_CAP),
  );

  const files = await discoverFiles();
  if (files.length === 0) {
    console.error(`test-runner: no files matched ${TEST_GLOB}`);
    return 1;
  }

  const units = buildUnits(files);
  const shards = packShards(units, shardCount);

  console.log(
    `test-runner: ${files.length} files across ${shards.length} shards ` +
      `(${shardCount} requested, ${navigator.hardwareConcurrency ?? '?'} cores)`,
  );

  const start = performance.now();
  const results = await Promise.all(
    shards.map((shard, index) => runShard(index, shard.files, passthrough)),
  );
  const totalMs = performance.now() - start;

  const rule = '='.repeat(70);
  for (const result of results.sort((a, b) => a.index - b.index)) {
    const secs = (result.ms / 1000).toFixed(1);
    console.log(
      `\n${rule}\nshard ${result.index + 1}/${results.length}  ${result.fileCount} files  ${secs}s  exit ${result.exitCode}\n${rule}`,
    );
    process.stdout.write(result.output);
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  const slowest = (Math.max(...results.map((r) => r.ms)) / 1000).toFixed(1);
  const verdict = failed.length
    ? `FAILED shards: ${failed.map((r) => r.index + 1).join(', ')}`
    : 'all green';
  console.log(`\n${'-'.repeat(70)}`);
  console.log(
    `test-runner: ${results.length} shards in ${(totalMs / 1000).toFixed(1)}s (slowest shard ${slowest}s)  ${verdict}`,
  );

  if (profile) {
    for (const result of results.sort((a, b) => b.ms - a.ms)) {
      console.log(
        `  shard ${result.index + 1}: ${(result.ms / 1000).toFixed(1)}s, ${result.fileCount} files`,
      );
    }
  }

  return failed.length > 0 ? 1 : 0;
}

process.exit(await main());
