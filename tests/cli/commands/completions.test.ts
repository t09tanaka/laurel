import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

describe('cli completions', () => {
  test.each([
    ['bash', 'compgen'],
    ['zsh', '#compdef laurel'],
    ['fish', 'complete -c laurel'],
    ['pwsh', 'Register-ArgumentCompleter'],
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
    expect(stdout).toContain('bash, zsh, fish, pwsh');
    expect(stdout).toContain('completions install --shell zsh');
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

  test('zsh output contains #compdef laurel', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'zsh']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('#compdef laurel');
    expect(stdout).toContain('_arguments');
  });

  test('fish output uses complete -c laurel', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'fish']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('complete -c laurel');
  });

  test('powershell output uses Register-ArgumentCompleter', async () => {
    const { stdout, exitCode } = await runCli(['completions', 'powershell']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Register-ArgumentCompleter');
  });

  test('install writes bash completions under XDG_DATA_HOME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-completions-bash-'));
    try {
      const xdgDataHome = join(dir, 'data');
      const { stdout, stderr, exitCode } = await runCli(
        ['completions', 'install', '--shell', 'bash'],
        {
          HOME: dir,
          XDG_DATA_HOME: xdgDataHome,
        },
      );
      const target = join(xdgDataHome, 'bash-completion', 'completions', 'laurel');
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain(target);
      expect(await readFile(target, 'utf8')).toContain('compgen');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('install auto-detects zsh and writes under ZDOTDIR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-completions-zsh-'));
    try {
      const zdotdir = join(dir, 'zdot');
      const { stdout, stderr, exitCode } = await runCli(['completions', 'install'], {
        HOME: dir,
        SHELL: '/bin/zsh',
        ZDOTDIR: zdotdir,
      });
      const target = join(zdotdir, 'completions', '_laurel');
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain(target);
      expect(await readFile(target, 'utf8')).toContain('#compdef laurel');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('install writes fish completions under XDG_CONFIG_HOME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-completions-fish-'));
    try {
      const xdgConfigHome = join(dir, 'config');
      const { stdout, stderr, exitCode } = await runCli(
        ['completions', 'install', '--shell', 'fish'],
        {
          HOME: dir,
          XDG_CONFIG_HOME: xdgConfigHome,
        },
      );
      const target = join(xdgConfigHome, 'fish', 'completions', 'laurel.fish');
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain(target);
      expect(await readFile(target, 'utf8')).toContain('complete -c laurel');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('install writes pwsh completions under XDG_CONFIG_HOME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'laurel-completions-pwsh-'));
    try {
      const xdgConfigHome = join(dir, 'config');
      const { stdout, stderr, exitCode } = await runCli(
        ['completions', 'install', '--shell', 'pwsh'],
        {
          HOME: dir,
          XDG_CONFIG_HOME: xdgConfigHome,
        },
      );
      const target = join(xdgConfigHome, 'powershell', 'laurel-completions.ps1');
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain(target);
      expect(await readFile(target, 'utf8')).toContain('Register-ArgumentCompleter');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
