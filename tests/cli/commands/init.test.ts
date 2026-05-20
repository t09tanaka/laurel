import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string, stdinInput?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdin: stdinInput !== undefined ? new Blob([stdinInput]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

function expectLfOnly(bytes: Uint8Array): void {
  expect(bytes.includes(13)).toBe(false);
}

describe('cli init', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-init-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--yes scaffolds nectar.toml, .gitignore, README, and starter content', async () => {
    const { exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('[site]');
    expect(toml).toContain('title = "My Nectar Site"');
    expect(toml).toContain('url = "http://localhost:4321"');
    expect(toml).toContain('[theme]');
    expect(toml).toContain('name = "source"');
    expect(toml).toContain('[components.rss]');
    expect(toml).toMatch(/enabled = true/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');

    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('# My Nectar Site');
    expect(readme).toContain('bunx nectar build');
    expect(readme).toContain('GitHub Pages');

    const welcome = await readFile(join(dir, 'content/posts/welcome.md'), 'utf8');
    expect(welcome).toContain('title: "Welcome to My Nectar Site"');
    expect(welcome).toContain('slug: welcome');

    const about = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
    expect(about).toContain('slug: about');

    const author = await readFile(join(dir, 'content/authors/default.md'), 'utf8');
    expect(author).toContain('slug: default');
  });

  test('--yes writes generated text files with LF-only line endings', async () => {
    const { exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);

    for (const path of [
      'nectar.toml',
      '.gitignore',
      'README.md',
      'content/posts/welcome.md',
      'content/pages/about.md',
      'content/authors/default.md',
    ]) {
      expectLfOnly(await readFile(join(dir, path)));
    }
  });

  test('refuses to overwrite existing files without --force', async () => {
    await writeFile(join(dir, 'nectar.toml'), 'pre-existing config');

    const { stderr, exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Refusing to overwrite');
    expect(stderr).toContain('nectar.toml');
    expect(stderr).toContain('--force');

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toBe('pre-existing config');
  });

  test('--force overwrites existing files', async () => {
    await writeFile(join(dir, 'nectar.toml'), 'pre-existing config');

    const { exitCode } = await runCli(['init', '--yes', '--force'], dir);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).not.toBe('pre-existing config');
    expect(toml).toContain('[site]');
  });

  test('--dir scaffolds into a sibling directory', async () => {
    const sub = join(dir, 'newsite');
    const { exitCode } = await runCli(['init', '--yes', '--dir', sub], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(sub, 'nectar.toml'))).toBe(true);
    expect(await fileExists(join(sub, 'README.md'))).toBe(true);
    expect(await fileExists(join(dir, 'nectar.toml'))).toBe(false);
  });

  test('interactive mode reads answers from stdin', async () => {
    const stdin = [
      'My Blog', // title
      'https://example.com', // url
      '2', // theme: casper (second in KNOWN_THEMES)
      'n', // starter content: no
      'n', // rss: no
      '2', // deploy: netlify
      '',
    ].join('\n');

    const { exitCode } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('title = "My Blog"');
    expect(toml).toContain('url = "https://example.com"');
    expect(toml).toContain('name = "casper"');
    expect(toml).toContain('enabled = false');

    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain('Netlify');

    expect(await fileExists(join(dir, 'content/posts/welcome.md'))).toBe(false);
    expect(await fileExists(join(dir, 'content/pages/about.md'))).toBe(false);
  });

  test('interactive mode accepts defaults via empty input', async () => {
    const stdin = '\n\n\n\n\n\n';
    const { exitCode } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('title = "My Nectar Site"');
    expect(toml).toContain('name = "source"');
  });

  test('--help prints subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['init', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Scaffold a new Nectar project');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--force');
    expect(stdout).toContain('--dir <path>');
  });

  test('appears in top-level usage', async () => {
    const { stdout } = await runCli(['--help'], dir);
    expect(stdout).toContain('init');
    expect(stdout).toContain('Scaffold a new Nectar project');
  });
});
