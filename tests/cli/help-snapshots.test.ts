import { beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { COMMAND_NAMES } from '~/cli/specs.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const SNAPSHOT_DIR = fileURLToPath(new URL('../fixtures/cli-help-snapshots/', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NECTAR_NO_COLOR: '1',
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: normalizeHelp(stdout), stderr, exitCode };
}

function normalizeHelp(output: string): string {
  // Match both legacy `nectar 1.2.3` per-subcommand headers and the branded
  // `Nectar 1.2.3` top-level header so a version bump doesn't churn snapshots.
  return output
    .replace(/^nectar \d+\.\d+\.\d+$/m, 'nectar <version>')
    .replace(/(Nectar) \d+\.\d+\.\d+/g, '$1 <version>');
}

async function readSnapshot(name: string): Promise<string> {
  return readFile(`${SNAPSHOT_DIR}/${name}.txt`, 'utf8');
}

// Each `--help` invocation is an independent, read-only CLI spawn, so running
// them one test-at-a-time wastes most of the wall-clock waiting on process
// startup. `bun test` has no cross-test concurrency, so we spawn every
// invocation up front through a bounded pool and let each test assert against
// the cached result. Per-invocation test granularity is preserved, so a single
// drifted snapshot still points at the exact command + invocation form.
const SPAWN_CONCURRENCY = 16;

interface Invocation {
  key: string;
  args: string[];
  snapshot: string;
}

function invocationsFor(command: string): Invocation[] {
  return [
    { key: `${command}:--help`, args: [command, '--help'], snapshot: command },
    { key: `${command}:-h`, args: [command, '-h'], snapshot: command },
    { key: `${command}:help-prefix`, args: ['help', command], snapshot: command },
    { key: `${command}:help-suffix`, args: [command, 'help'], snapshot: command },
  ];
}

const ALL_INVOCATIONS: Invocation[] = [
  { key: 'root:--help', args: ['--help'], snapshot: 'root' },
  ...COMMAND_NAMES.flatMap(invocationsFor),
];

const results = new Map<string, RunResult>();

async function runPool(invocations: Invocation[], limit: number): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const invocation = invocations[cursor++];
      if (!invocation) break;
      results.set(invocation.key, await runCli(invocation.args));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, invocations.length) }, worker));
}

describe('cli help snapshots', () => {
  beforeAll(async () => {
    await runPool(ALL_INVOCATIONS, SPAWN_CONCURRENCY);
  });

  async function expectSnapshot(key: string, snapshot: string): Promise<void> {
    const result = results.get(key);
    expect(result, `missing precomputed result for ${key}`).toBeDefined();
    expect(result?.exitCode).toBe(0);
    expect(result?.stderr).toBe('');
    expect(result?.stdout).toBe(await readSnapshot(snapshot));
  }

  test('root --help matches the stable snapshot', async () => {
    await expectSnapshot('root:--help', 'root');
  });

  test.each(COMMAND_NAMES)('%s --help matches the stable snapshot', async (command) => {
    await expectSnapshot(`${command}:--help`, command);
  });

  test.each(COMMAND_NAMES)('%s -h matches the stable snapshot', async (command) => {
    await expectSnapshot(`${command}:-h`, command);
  });

  test.each(COMMAND_NAMES)('help %s matches the stable snapshot', async (command) => {
    await expectSnapshot(`${command}:help-prefix`, command);
  });

  test.each(COMMAND_NAMES)('%s help matches the stable snapshot', async (command) => {
    await expectSnapshot(`${command}:help-suffix`, command);
  });
});
