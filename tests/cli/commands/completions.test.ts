import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('cli completions', () => {
  test.each([
    ['bash', 'compgen'],
    ['zsh', '#compdef nectar'],
    ['fish', 'complete -c nectar'],
  ])('singular completion alias prints %s shell completions', async (shell, marker) => {
    const { stdout, stderr, exitCode } = await runCli(['completion', shell]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(marker);
  });

  test('generated root command completions include the singular alias', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'bash']);
    expect(exitCode).toBe(0);
    const rootWords = stdout.match(/compgen -W "([^"]+)"/)?.[1]?.split(' ') ?? [];
    expect(rootWords).toContain('completion');
    expect(rootWords).toContain('completions');
  });

  test('--help advertises the shell positional', async () => {
    const { stdout, exitCode } = await runCli(['completions', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('bash, zsh, fish, or powershell');
  });

  test('bash output contains compgen and the command list', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'bash']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('compgen');
    expect(stdout).toContain('build');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('clean');
    expect(stdout).toContain('content');
  });

  test('zsh output contains #compdef nectar', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'zsh']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('#compdef nectar');
    expect(stdout).toContain('_arguments');
  });

  test('fish output uses complete -c nectar', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'fish']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('complete -c nectar');
  });

  test('powershell output uses Register-ArgumentCompleter', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'powershell']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Register-ArgumentCompleter');
  });

  test('unsupported shell exits with code 2', async () => {
    const { stderr, exitCode } = await runCli(['completions', 'tcsh']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unsupported shell');
  });

  test('missing positional exits with code 2', async () => {
    const { stderr, exitCode } = await runCli(['completions']);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain('shell');
  });
});
