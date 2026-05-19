import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectLiveReloadScript, isIgnoredChange } from '~/cli/commands/serve.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
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

async function makeServeFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-')));
  await Bun.write(join(dir, 'nectar.toml'), '[site]\ntitle = "x"\n');
  await Bun.write(join(dir, 'dist/index.html'), '<!doctype html><title>ok</title>');
  return dir;
}

describe('cli serve — host binding', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --help advertises --host with localhost default and 0.0.0.0 opt-in', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--host <host>');
    expect(stdout).toContain('localhost');
    expect(stdout).toContain('0.0.0.0');
  });

  test('default binding is localhost — log line reports it explicitly', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '52001', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to localhost');
    expect(stderr).not.toContain('bound to 0.0.0.0');
  });

  test('--host 0.0.0.0 opts in to LAN exposure and is reflected in the log line', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--port', '52002', '--host', '0.0.0.0', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to 0.0.0.0');
  });

  test('--host 127.0.0.1 is honored verbatim in the log line', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--port', '52003', '--host', '127.0.0.1', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain('bound to 127.0.0.1');
  });

  test('rejects empty --host with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--host', '   ', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --host');
  });
});

describe('cli serve — watch mode', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --help advertises --no-watch opt-out', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--no-watch');
    expect(stdout).toContain('static snapshot');
  });

  test('serve stays alive after startup until terminated (watch is the default)', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'serve', '--port', '52010'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Watch mode enabled')) break;
      }
      expect(stderr).toContain('Watch mode enabled');
      expect(proc.killed).toBe(false);
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('serve --no-watch returns immediately without engaging watchers', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '52011', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Watch mode enabled');
  });
});

describe('cli serve — auto-build when dist/ is missing', () => {
  async function makeServeFixtureWithoutDist(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-nodist-')));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Auto Build Test"',
        'url = "https://autobuild.test"',
        '',
        '[theme]',
        'dir = "themes"',
        'name = "source"',
        '',
        '[components.rss]',
        'enabled = false',
        '',
        '[components.sitemap]',
        'enabled = false',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/hello.md'),
      '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
      'utf8',
    );
    await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixtureWithoutDist();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --no-watch runs an initial build instead of erroring out', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '52020', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stderr).toContain('running an initial build');
    expect(stderr).toContain('Initial build complete');
    expect(stderr).not.toContain('No build output found');
  });
});

describe('isIgnoredChange', () => {
  test('ignores generated theme artifacts that the build reads back', () => {
    expect(isIgnoredChange('assets/built/source.js.map')).toBe(true);
    expect(isIgnoredChange('assets/built/screen.css')).toBe(true);
    expect(isIgnoredChange('node_modules/foo/index.js')).toBe(true);
    expect(isIgnoredChange('.DS_Store')).toBe(true);
    expect(isIgnoredChange('partials/.hidden.hbs')).toBe(true);
    expect(isIgnoredChange('post.hbs~')).toBe(true);
  });

  test('allows real source files', () => {
    expect(isIgnoredChange('posts/hello.md')).toBe(false);
    expect(isIgnoredChange('index.hbs')).toBe(false);
    expect(isIgnoredChange('locales/en.json')).toBe(false);
    expect(isIgnoredChange('nectar.toml')).toBe(false);
  });
});

describe('injectLiveReloadScript', () => {
  test('injects the client script before </body>', () => {
    const html = '<!doctype html><html><body><h1>hi</h1></body></html>';
    const out = injectLiveReloadScript(html);
    expect(out).toContain('__nectar_livereload');
    expect(out.indexOf('__nectar_livereload')).toBeLessThan(out.indexOf('</body>'));
  });

  test('appends the script when </body> is missing', () => {
    const html = '<!doctype html><p>fragment</p>';
    const out = injectLiveReloadScript(html);
    expect(out.startsWith(html)).toBe(true);
    expect(out).toContain('__nectar_livereload');
  });
});

describe('cli serve — port collision', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('exits with code 2 and a friendly message when the port is already in use', async () => {
    const blocker = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch() {
        return new Response('blocker');
      },
    });
    try {
      const { stderr, exitCode } = await runCli(
        ['serve', '--port', String(blocker.port), '--host', '127.0.0.1', '--no-watch'],
        dir,
      );
      expect(exitCode).toBe(2);
      expect(stderr).toContain(`Port ${blocker.port} is in use`);
      expect(stderr).toContain(`--port ${blocker.port + 1}`);
    } finally {
      blocker.stop(true);
    }
  });
});
