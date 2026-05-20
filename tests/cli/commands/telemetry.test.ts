import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TelemetryCliEnv extends Record<string, string> {
  NECTAR_TELEMETRY_CONFIG: string;
}

let dir: string | undefined;

async function makeEnv(): Promise<TelemetryCliEnv> {
  dir = await mkdtemp(join(tmpdir(), 'nectar-telemetry-cli-'));
  return {
    NECTAR_TELEMETRY_CONFIG: join(dir, 'telemetry.json'),
  };
}

async function runCli(args: string[], env: TelemetryCliEnv): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('cli telemetry command', () => {
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('status reports disabled by default', async () => {
    const env = await makeEnv();
    const { stdout, stderr, exitCode } = await runCli(['telemetry', 'status'], env);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Telemetry: disabled');
    expect(stdout).toContain('Anonymous machine id: (not created)');
  });

  test('enable writes opt-in config with custom endpoint', async () => {
    const env = await makeEnv();
    const { stdout, stderr, exitCode } = await runCli(
      ['telemetry', 'enable', '--endpoint', 'https://example.test/usage'],
      env,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Telemetry enabled.');
    expect(stdout).toContain('Endpoint: https://example.test/usage');

    const config = JSON.parse(await readFile(env.NECTAR_TELEMETRY_CONFIG, 'utf8')) as {
      enabled: boolean;
      endpoint: string;
      anonymousMachineId: string;
    };
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe('https://example.test/usage');
    expect(config.anonymousMachineId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('disable keeps anonymous id but stops future sending', async () => {
    const env = await makeEnv();
    await runCli(['telemetry', 'enable'], env);
    const enabled = JSON.parse(await readFile(env.NECTAR_TELEMETRY_CONFIG, 'utf8')) as {
      anonymousMachineId: string;
    };

    const { stdout, stderr, exitCode } = await runCli(['telemetry', 'disable'], env);
    const disabled = JSON.parse(await readFile(env.NECTAR_TELEMETRY_CONFIG, 'utf8')) as {
      enabled: boolean;
      anonymousMachineId: string;
    };

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Telemetry disabled.');
    expect(disabled.enabled).toBe(false);
    expect(disabled.anonymousMachineId).toBe(enabled.anonymousMachineId);
  });

  test('unknown telemetry subcommand exits with usage error', async () => {
    const env = await makeEnv();
    const { stderr, exitCode } = await runCli(['telemetry', 'wat'], env);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown telemetry subcommand');
    expect(stderr).toContain('nectar telemetry enable');
  });
});
