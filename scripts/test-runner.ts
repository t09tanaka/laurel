#!/usr/bin/env bun
// Parallel test shard runner.
//
// Nectar has many cheap unit tests plus several expensive CLI integration test
// files that spawn `bun` dozens of times. File-level sharding alone leaves
// those large files as the wall-clock floor, so this runner can split selected
// slow files by top-level describe name with `--test-name-pattern`.
//
// A handful of tests write to fixed in-repo paths (the real `example/dist`, the
// CLI bundle) and would corrupt each other if run concurrently. Those are
// pinned into one shard (see SERIAL_GROUP); every other test isolates under
// `mkdtemp` and is safe to shard freely.
//
// Usage:
//   bun run scripts/test-runner.ts                 # shard the whole suite
//   bun run scripts/test-runner.ts tests/render     # explicit paths -> delegate
//   NECTAR_TEST_SHARDS=6 bun run scripts/test-runner.ts
//
// Any explicit path argument, or a flag that needs a single process
// (--coverage, --watch, -t), bypasses sharding and delegates straight to
// `bun test` so subset runs and coverage stay correct.

import { spawn } from 'bun';

const TEST_GLOB = 'tests/**/*.test.ts';
const BATCH_FILE_LIMIT = 48;

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

const ISOLATED_FILES = ['tests/build/pipeline.test.ts', 'tests/cli/commands/dashboard.test.ts'];

const EXCLUSIVE_FILES = ['tests/cli/commands/init.test.ts'];

// Task weights (approx. wall-seconds) used only to balance shards via
// longest-processing-time-first bin packing. They do not affect correctness:
// a wrong weight just yields slightly uneven shards. Only the long-tail-beating
// hot spots (>1s, all child-process / build heavy) are listed; everything else
// is fast and uses DEFAULT_WEIGHT. Re-measure with `--profile` and refresh when
// the suite shifts.
const DEFAULT_WEIGHT = 0.2;
const FILE_WEIGHTS: Record<string, number> = {
  'tests/cli/commands/build.test.ts': 26,
  'tests/e2e/example-browser.test.ts': 8.5,
  'tests/build/pipeline.test.ts': 8,
  'tests/cli/commands/import-ghost.test.ts': 20,
  'tests/cli/commands/serve.test.ts': 17,
  'tests/cli/commands/new.test.ts': 16,
  'tests/cli/commands/deploy.test.ts': 12,
  'tests/cli/commands/content.test.ts': 3.8,
  'tests/cli/dispatch.test.ts': 3.6,
  'tests/packaging.test.ts': 2.9,
  'tests/cli/commands/dev.test.ts': 2.8,
  'tests/cli/commands/check.test.ts': 2.7,
  'tests/build/generate-og-images.test.ts': 2.4,
  'tests/ghost/import.test.ts': 2,
  'tests/cli/help-snapshots.test.ts': 1.9,
  'tests/cli/commands/init.test.ts': 1.8,
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

const SPLIT_GROUPS: Record<string, Array<{ label: string; pattern: string; weight: number }>> = {
  'tests/cli/commands/build.test.ts': [
    {
      label: 'build:dry-run',
      pattern: '^(nectar build exit codes|nectar build --dry-run|formatDryRunRouteTable)',
      weight: 16,
    },
    {
      label: 'build:base-url',
      pattern:
        '^(nectar build base URL precedence|nectar build --config layering|nectar build preview noindex protection)',
      weight: 28,
    },
    {
      label: 'build:watch-api',
      pattern: '^(nectar build --watch|nectar build --emit-content-api|isIgnoredChange)',
      weight: 13,
    },
    {
      label: 'build:misc',
      pattern:
        '^(nectar build:email|nectar build --no-clean|nectar build --profile|nectar build --include-drafts)',
      weight: 13,
    },
  ],
  'tests/cli/commands/import-ghost.test.ts': [
    {
      label: 'import-ghost:conflict-assets',
      pattern: '^(cli import-ghost . (--on-conflict|folder input \\+ --assets|input validation))',
      weight: 22,
    },
    {
      label: 'import-ghost:filters-output',
      pattern: '^(cli import-ghost . (--dry-run|partial filters|--output|post progress))',
      weight: 15,
    },
    {
      label: 'import-ghost:limits',
      pattern:
        '^(cli import-ghost . (--max-size|--max-image-size|--max-post-html-size)|parseSizeSpec)',
      weight: 13,
    },
    {
      label: 'import-ghost:html-code',
      pattern: '^(cli import-ghost . (--keep-code-injection|--keep-html))',
      weight: 9,
    },
  ],
  'tests/cli/commands/serve.test.ts': [
    {
      label: 'serve:binding',
      pattern: '^(cli serve . (host binding|proxy and TLS validation|request path confinement))',
      weight: 14,
    },
    {
      label: 'serve:lifecycle',
      pattern:
        '^(cli serve . (watch mode|access logs|compression|dev cache control|file lookup cache|cached 404 fallback headers|auto-build when dist/ is missing|port collision))',
      weight: 16,
    },
    {
      label: 'serve:misc',
      pattern:
        '^(cli serve . (--open|verbose examples|deploy artifact simulation|content types|--port validation|base_path in startup log|--build)|isIgnoredChange|injectLiveReloadScript)',
      weight: 16,
    },
  ],
  'tests/cli/commands/new.test.ts': [
    { label: 'new:slug', pattern: '^cli new . slug collision handling', weight: 22 },
    { label: 'new:frontmatter', pattern: '^cli new . frontmatter flags', weight: 16 },
    {
      label: 'new:kinds',
      pattern: '^cli new . (tag and author kinds|extensible kinds)',
      weight: 13,
    },
  ],
};

interface TestTask {
  files: string[];
  label: string;
  weight: number;
  exclusive?: boolean;
  isolated?: boolean;
  pattern?: string;
}

interface Shard {
  tasks: TestTask[];
  weight: number;
}

// Longest-processing-time-first: assign each unit (heaviest first) to the
// lightest shard so far. Simple, deterministic, and close to optimal for the
// skewed weight distribution a test suite has.
function packShards(units: TestTask[], shardCount: number): Shard[] {
  const shards: Shard[] = Array.from({ length: shardCount }, () => ({ tasks: [], weight: 0 }));
  const ordered = [...units].sort((a, b) => b.weight - a.weight);
  for (const unit of ordered) {
    let lightest = shards[0];
    for (const shard of shards) {
      if (shard.weight < lightest.weight) lightest = shard;
    }
    lightest.tasks.push(unit);
    lightest.weight += unit.weight;
  }
  return shards.filter((shard) => shard.tasks.length > 0);
}

async function discoverFiles(): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob(TEST_GLOB);
  for await (const file of glob.scan({ cwd: process.cwd() })) {
    files.push(file);
  }
  return files.sort();
}

function buildTasks(files: string[]): TestTask[] {
  const grouped = new Set(SERIAL_GROUP);
  const exclusive = new Set(EXCLUSIVE_FILES);
  const isolated = new Set(ISOLATED_FILES);
  const present = SERIAL_GROUP.filter((file) => files.includes(file));
  const units: TestTask[] = [];

  if (present.length > 0) {
    units.push({
      files: present,
      label: 'serial',
      weight: present.reduce((sum, file) => sum + weightFor(file), 0),
    });
  }

  for (const file of files) {
    if (grouped.has(file)) continue;
    if (exclusive.has(file)) {
      units.push({ files: [file], exclusive: true, label: file, weight: weightFor(file) });
      continue;
    }
    if (isolated.has(file)) {
      units.push({ files: [file], isolated: true, label: file, weight: weightFor(file) });
      continue;
    }
    const splits = SPLIT_GROUPS[file];
    if (splits !== undefined) {
      for (const split of splits) {
        units.push({
          files: [file],
          label: split.label,
          pattern: split.pattern,
          weight: split.weight,
        });
      }
      continue;
    }
    units.push({ files: [file], label: file, weight: weightFor(file) });
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

function childTestEnv(): Record<string, string> {
  const { GITHUB_ACTIONS: _githubActions, ...env } = process.env;
  return env;
}

function formatTaskFiles(files: string[]): string {
  if (files.length <= 3) return files.join(', ');
  return `${files.length} files`;
}

async function runBunTest(
  index: number,
  task: Pick<TestTask, 'files' | 'label' | 'pattern'>,
  extraArgs: string[],
): Promise<ShardResult> {
  const start = performance.now();
  const taskArgs = task.pattern ? ['--test-name-pattern', task.pattern, ...task.files] : task.files;
  const proc = spawn(['bun', 'test', ...extraArgs, ...taskArgs], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: childTestEnv(),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const diagnostics =
    exitCode === 0
      ? ''
      : `\n[test-runner] task ${task.label} exited ${exitCode}: bun test ${[
          ...extraArgs,
          ...taskArgs,
        ].join(' ')}\n`;
  return {
    index,
    fileCount: task.files.length,
    exitCode,
    ms: performance.now() - start,
    // bun test writes its human report to stderr; stdout carries test logs.
    output: `\n--- ${task.label} (${formatTaskFiles(task.files)}) ---\n${stderr}${stdout}${diagnostics}`,
  };
}

async function runShardTasks(
  index: number,
  tasks: TestTask[],
  extraArgs: string[],
): Promise<ShardResult> {
  const start = performance.now();
  const outputs: string[] = [];
  const patterned = tasks.filter((task) => task.pattern !== undefined);
  const isolated = tasks.filter((task) => task.pattern === undefined && task.isolated);
  const batchChunks = chunkBatchTasks(
    tasks.filter((task) => task.pattern === undefined && !task.isolated),
    BATCH_FILE_LIMIT,
  );
  let exitCode = 0;

  for (const task of patterned) {
    const result = await runBunTest(index, task, extraArgs);
    outputs.push(result.output);
    if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode;
  }

  for (const task of isolated) {
    const result = await runBunTest(index, task, extraArgs);
    outputs.push(result.output);
    if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode;
  }

  for (const [chunkIndex, files] of batchChunks.entries()) {
    const result = await runBunTest(
      index,
      { files, label: `batch ${chunkIndex + 1}/${batchChunks.length}` },
      extraArgs,
    );
    outputs.push(result.output);
    if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode;
  }

  return {
    index,
    fileCount: new Set(tasks.flatMap((task) => task.files)).size,
    exitCode,
    ms: performance.now() - start,
    output: outputs.join(''),
  };
}

function chunkBatchTasks(tasks: TestTask[], limit: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const task of tasks) {
    if (current.length > 0 && current.length + task.files.length > limit) {
      chunks.push(current);
      current = [];
    }
    current.push(...task.files);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function isDelegatingArg(arg: string): boolean {
  // Explicit paths or single-process flags bypass sharding.
  if (!arg.startsWith('-')) return true;
  return (
    arg === '--coverage' ||
    arg === '--watch' ||
    arg === '-t' ||
    arg === '--test-name-pattern' ||
    arg.startsWith('--test-name-pattern=') ||
    arg.startsWith('--parallel') ||
    arg.startsWith('--shard')
  );
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
  // core count then oversubscribes the CPU and stops paying off past ~4-6 here;
  // it also risks resource exhaustion on high-core machines. Cap at 6 by
  // default and let NECTAR_TEST_SHARDS override for tuning.
  const SHARD_CAP = 6;
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

  const units = buildTasks(files);
  const exclusiveUnits = units.filter((unit) => unit.exclusive);
  const shardUnits = units.filter((unit) => !unit.exclusive);
  const shards = packShards(shardUnits, shardCount);
  const bunArgs = [...passthrough];
  if (!bunArgs.some((arg) => arg === '--timeout' || arg.startsWith('--timeout='))) {
    bunArgs.push('--timeout=30000');
  }

  console.log(
    `test-runner: ${files.length} files / ${units.length} tasks across ${shards.length} shards (${shardCount} requested, ${navigator.hardwareConcurrency ?? '?'} cores)${exclusiveUnits.length > 0 ? ` + ${exclusiveUnits.length} exclusive` : ''}`,
  );

  const start = performance.now();
  const exclusiveResult =
    exclusiveUnits.length > 0 ? await runShardTasks(-1, exclusiveUnits, bunArgs) : undefined;
  const shardResults = await Promise.all(
    shards.map((shard, index) => runShardTasks(index, shard.tasks, bunArgs)),
  );
  const results = exclusiveResult ? [exclusiveResult, ...shardResults] : shardResults;
  const totalMs = performance.now() - start;

  const rule = '='.repeat(70);
  for (const result of results.sort((a, b) => a.index - b.index)) {
    const secs = (result.ms / 1000).toFixed(1);
    const label = result.index === -1 ? 'exclusive' : `shard ${result.index + 1}/${shards.length}`;
    console.log(
      `\n${rule}\n${label}  ${result.fileCount} files  ${secs}s  exit ${result.exitCode}\n${rule}`,
    );
    process.stdout.write(result.output);
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  const slowest = (Math.max(...results.map((r) => r.ms)) / 1000).toFixed(1);
  const verdict = failed.length
    ? `FAILED shards: ${failed.map((r) => (r.index === -1 ? 'exclusive' : r.index + 1)).join(', ')}`
    : 'all green';
  console.log(`\n${'-'.repeat(70)}`);
  console.log(
    `test-runner: ${shards.length} shards${exclusiveUnits.length > 0 ? ' + exclusive' : ''} in ${(totalMs / 1000).toFixed(1)}s (slowest shard ${slowest}s)  ${verdict}`,
  );

  if (profile) {
    for (const result of results.sort((a, b) => b.ms - a.ms)) {
      const label = result.index === -1 ? 'exclusive' : `shard ${result.index + 1}`;
      console.log(`  ${label}: ${(result.ms / 1000).toFixed(1)}s, ${result.fileCount} files`);
    }
  }

  return failed.length > 0 ? 1 : 0;
}

process.exitCode = await main();
