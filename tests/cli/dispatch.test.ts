import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env?: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: env === undefined ? undefined : { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('cli dispatch', () => {
  test('top-level --help prints usage and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('build');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('import-ghost');
  });

  test('no args prints usage', async () => {
    const { stdout, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('nectar <command>');
  });

  test('version prints the version number', async () => {
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('--version output matches package.json version', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  test('top-level --help renders the package.json version', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`nectar ${pkg.version}`);
  });

  test('unknown command exits 2 and suggests the closest match', async () => {
    const { stderr, exitCode } = await runCli(['buld']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: buld');
    expect(stderr).toContain('Did you mean `nectar build`');
  });

  test('unknown command without close match still prints usage', async () => {
    const { stderr, exitCode } = await runCli(['xyzfoo']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: xyzfoo');
    expect(stderr).not.toContain('Did you mean');
  });

  test('build --help prints subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
    expect(stdout).toContain('--config <path>');
    expect(stdout).toContain('-o, --output <dir>');
    expect(stdout).toContain('--base-path <path>');
    expect(stdout).toContain('--base-url <url>');
    expect(stdout).toContain('--concurrency <n>');
    expect(stdout).toContain('--strict');
  });

  test('build --concurrency rejects non-numeric values with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['build', '--concurrency', 'abc']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--concurrency');
    expect(stderr).toContain('positive integer');
    expect(stderr).toContain('Usage:');
  });

  test('build --concurrency rejects zero with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['build', '--concurrency', '0']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--concurrency');
    expect(stderr).toContain('positive integer');
  });

  test('build --concurrency rejects negative values with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['build', '--concurrency', '-1']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--concurrency');
  });

  test('serve --help prints subcommand help with --port flag', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--port <n>');
  });

  test('build with unknown flag exits 2 and prints subcommand help', async () => {
    const { stderr, exitCode } = await runCli(['build', '--bogus']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--bogus');
    expect(stderr).toContain('Usage:');
  });

  test('build with a close-typo flag suggests the intended flag', async () => {
    const { stderr, exitCode } = await runCli(['build', '--conifg', 'nectar.toml']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown option: --conifg');
    expect(stderr).toContain('Did you mean --config?');
  });

  test('serve with a close-typo flag suggests the intended flag', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--prot', '3000']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown option: --prot');
    expect(stderr).toContain('Did you mean --port?');
  });

  test('new with missing positionals exits 2', async () => {
    const { stderr, exitCode } = await runCli(['new']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument');
  });

  test('import-ghost --help prints positional documentation', async () => {
    const { stdout, exitCode } = await runCli(['import-ghost', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('<file>');
    expect(stdout).toContain('Ghost export');
  });

  test('top-level help mentions global --quiet and --verbose options', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--quiet');
    expect(stdout).toContain('-V, --verbose');
  });

  test('--quiet is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['--quiet', 'build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('-VV is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['-VV', 'build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('global flag after the command name is also stripped', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help', '-V']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('combining --quiet and --verbose is rejected with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['--quiet', '--verbose', 'build']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--quiet and --verbose cannot be used together');
  });

  test('build --help footer documents the env var convention', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Environment variables:');
    expect(stdout).toContain('NECTAR_<COMMAND>_<FLAG>');
    expect(stdout).toContain('NECTAR_BUILD_CONFIG');
  });

  test('invalid NECTAR_QUIET surfaces a usage error from the global flag parser', async () => {
    const { stderr, exitCode } = await runCli(['build', '--help'], { NECTAR_QUIET: 'maybe' });
    expect(exitCode).toBe(2);
    expect(stderr).toContain('NECTAR_QUIET');
  });

  test('invalid boolean env var on a subcommand surfaces a usage error', async () => {
    const { stderr, exitCode } = await runCli(['build'], { NECTAR_BUILD_STRICT: 'maybe' });
    expect(exitCode).toBe(2);
    expect(stderr).toContain('NECTAR_BUILD_STRICT');
  });

  test('top-level --help advertises the new global flags', async () => {
    const { stdout } = await runCli(['--help']);
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--no-color');
    expect(stdout).toContain('--debug');
  });

  test('per-command --help renders an Examples: block', async () => {
    const { stdout } = await runCli(['build', '--help']);
    expect(stdout).toContain('Examples:');
    expect(stdout).toContain('nectar build');
  });

  test('global --json before subcommand flows through to the subcommand parser', async () => {
    // `config path` produces a JSON envelope when --json is in scope. Passing
    // --json globally (before the command name) must reach the parsed.values.
    const { stdout, exitCode } = await runCli(['--json', 'config', 'path']);
    expect(exitCode).toBe(0);
    // Expect a JSON object on stdout (not a plain absolute path).
    expect(stdout.trim().startsWith('{')).toBe(true);
  });
});
