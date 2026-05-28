import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('no args prints usage and exits 2', async () => {
    const { stdout, stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage:');
    expect(stderr).toContain('nectar <command>');
  });

  test.each([['-h'], ['help']])('%s prints top-level help and exits 0', async (arg) => {
    const { stdout, stderr, exitCode } = await runCli([arg]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage:');
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

  test('version --json prints machine-readable version metadata', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    const { stdout, stderr, exitCode } = await runCli(['version', '--json']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const parsed = JSON.parse(stdout) as {
      name: string;
      version: string;
      bun: string | null;
      node: string;
      commit: string | null;
    };
    expect(parsed.name).toBe('nectar');
    expect(parsed.version).toBe(pkg.version);
    expect(typeof parsed.bun === 'string' || parsed.bun === null).toBe(true);
    expect(parsed.node).toBe(process.version);
    expect(typeof parsed.commit === 'string' || parsed.commit === null).toBe(true);
  });

  test('--json version uses the same machine-readable version output', async () => {
    const { stdout, stderr, exitCode } = await runCli(['--json', 'version']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const parsed = JSON.parse(stdout) as { name: string; version: string };
    expect(parsed.name).toBe('nectar');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('top-level --help renders the package.json version', async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as { version: string };
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Nectar ${pkg.version}`);
  });

  test('version --check respects NECTAR_NO_UPDATE_CHECK', async () => {
    const { stdout, stderr, exitCode } = await runCli(['version', '--check'], {
      NECTAR_NO_UPDATE_CHECK: '1',
    });
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Update check disabled by NECTAR_NO_UPDATE_CHECK');
  });

  test('version --help documents the update check flag', async () => {
    const { stdout, stderr, exitCode } = await runCli(['version', '--help']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('nectar version [--json]');
    expect(stdout).toContain('nectar version --check');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--check');
  });

  test('unknown command exits 2 and suggests the closest match', async () => {
    const { stderr, exitCode } = await runCli(['buld']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: buld');
    expect(stderr).toContain('Did you mean `nectar build`');
  });

  test('unknown command suggests top-level utility commands', async () => {
    const { stdout, stderr, exitCode } = await runCli(['versoin']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Unknown command: versoin');
    expect(stderr).toContain('Did you mean `nectar version`');
  });

  test('unknown command without close match still prints usage', async () => {
    const { stdout, stderr, exitCode } = await runCli(['xyzfoo']);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Unknown command: xyzfoo');
    expect(stderr).not.toContain('Did you mean');
  });

  test('short cargo-style command aliases dispatch to their canonical commands', async () => {
    const { stdout, stderr, exitCode } = await runCli(['b', '--help']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Build the site');
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

  test.each([
    ['build', '-h'],
    ['build', 'help'],
    ['schema', 'help'],
  ])('%s %s prints subcommand help', async (command, helpArg) => {
    const { stdout, stderr, exitCode } = await runCli([command, helpArg]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain(`nectar ${command}`);
    expect(stdout).toContain('-h, --help');
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

  test('plugins list reserves the extension namespace', async () => {
    const { stdout, stderr, exitCode } = await runCli(['plugins', 'list']);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('No plugins installed.');
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
    expect(stderr).toContain('Missing kind.');
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
    expect(stdout).toContain('--log-format <json|pretty>');
  });

  test('--quiet is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['--quiet', 'build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Build the site');
  });

  test('-q is stripped before subcommand parsing', async () => {
    const { stdout, exitCode } = await runCli(['-q', 'build', '--help']);
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

  test('invalid --log-format is rejected with exit 2', async () => {
    const { stderr, exitCode } = await runCli(['--log-format=xml', 'build']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --log-format');
  });

  test('--log-format=json switches logs without forcing command json output', async () => {
    const { stdout, exitCode } = await runCli(['--log-format=json', 'version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('NECTAR_LOG_FORMAT=json emits JSON Lines logs without forcing command json output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-json-log-init-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(['init', '--yes', '--dir', dir], {
        NECTAR_LOG_FORMAT: 'json',
      });
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');

      const lines = stdout.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(4);
      const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records[0]).toMatchObject({
        level: 'info',
        msg: `Initialised Nectar project in ${dir}`,
      });
      expect(records.every((record) => typeof record.ts === 'string')).toBe(true);
      expect(stdout).not.toContain('\x1b[');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--log-format=pretty overrides NECTAR_LOG_FORMAT=json for human logs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pretty-log-init-'));
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['--log-format=pretty', 'init', '--yes', '--dir', dir],
        { NECTAR_LOG_FORMAT: 'json' },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('Nectar project initialised');
      expect(stdout).toContain(dir);
      expect(() => JSON.parse(stdout.trim().split('\n')[0] ?? '')).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
    expect(stdout).toContain('--log-format');
    expect(stdout).toContain('--no-color');
    expect(stdout).toContain('--debug');
    expect(stdout).toContain('--warnings-as-errors');
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

  test('global -j before subcommand flows through to the subcommand parser', async () => {
    const { stdout, exitCode } = await runCli(['-j', 'config', 'path']);
    expect(exitCode).toBe(0);
    expect(stdout.trim().startsWith('{')).toBe(true);
  });

  test('top-level help carries the Nectar brand header and tagline', async () => {
    const { stdout, exitCode } = await runCli(['--help'], {
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      NECTAR_NO_COLOR: '1',
    });
    expect(exitCode).toBe(0);
    // Brand line: capitalised "Nectar", version, dim separator (ASCII `-` when
    // color is off), and the tagline that matches package.json description.
    expect(stdout).toMatch(/Nectar \d+\.\d+\.\d+ {2}- {2}Ghost-theme-compatible/);
    // Section labels and footer hint.
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('Commands:');
    expect(stdout).toContain('Global options:');
    expect(stdout).toContain('Run `nectar <command> --help` for details on each command.');
    // Lines are indented with three spaces like the dev banner.
    expect(stdout).toMatch(/^ {3}Nectar /m);
  });

  test('top-level help lists every command from COMMAND_SPECS', async () => {
    const { COMMAND_NAMES } = await import('~/cli/specs.ts');
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    for (const name of COMMAND_NAMES) {
      expect(stdout).toContain(name);
    }
    // Built-in CLI verbs that aren't in COMMAND_SPECS still surface.
    expect(stdout).toContain('version');
    expect(stdout).toContain('help');
  });

  test('top-level help uses ANSI color when FORCE_COLOR is set', async () => {
    const { stdout, exitCode } = await runCli(['--help'], { FORCE_COLOR: '1' });
    expect(exitCode).toBe(0);
    // Cyan accent wraps the "Nectar" word.
    expect(stdout).toContain('\x1b[36mNectar\x1b[0m');
    // Color mode swaps the ASCII `-` separator for the middot used by the banner.
    expect(stdout).toContain('·');
  });
});
