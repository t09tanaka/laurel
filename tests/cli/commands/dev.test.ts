import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnoredChange } from '~/cli/commands/dev.ts';

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

async function makeDevFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-dev-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Dev Test"',
      'url = "https://dev.test"',
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

describe('cli dev — help', () => {
  test('dev --help advertises --port, --host, --config', async () => {
    const { stdout, exitCode } = await runCli(['dev', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--port');
    expect(stdout).toContain('--host');
    expect(stdout).toContain('--config');
  });

  test('top-level help lists dev', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dev');
  });

  test('rejects empty --host with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['dev', '--host', '   ']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --host');
  });

  test('rejects non-integer --port with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['dev', '--port', '80.5']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });

  test('rejects out-of-range --port (>65535) with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['dev', '--port', '70000']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });

  test('accepts --port 0 (kernel-picked free port)', async () => {
    const dir = await makeDevFixture();
    try {
      const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        let stderr = '';
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value, { stream: true });
          if (stderr.includes('Watch mode enabled')) break;
        }
        expect(stderr).toContain('Listening on');
        expect(stderr).toContain('Watch mode enabled');
        // --port 0 → kernel picks a real port; the announced URL must contain
        // a concrete (non-zero) port so users can actually visit it.
        const match = stderr.match(/Listening on http:\/\/localhost:(\d+)/);
        expect(match).not.toBeNull();
        if (match !== null) {
          const announcedPort = Number(match[1]);
          expect(announcedPort).toBeGreaterThan(0);
        }
        reader.releaseLock();
      } finally {
        proc.kill('SIGTERM');
        await proc.exited;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('cli dev — lifecycle', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDevFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('starts up, listens, watches, and shuts down on SIGTERM', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Watch mode enabled')) break;
      }
      expect(stderr).toContain('Running initial build');
      expect(stderr).toContain('Initial build complete');
      expect(stderr).toContain('Listening on');
      expect(stderr).toContain('Watch mode enabled');
      expect(proc.killed).toBe(false);
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);

  test('serves the livereload client script at /__nectar/livereload.js', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Listening on')) break;
      }
      const match = stderr.match(/Listening on http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);
      const res = await fetch(`http://localhost:${port}/__nectar/livereload.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('javascript');
      const body = await res.text();
      expect(body).toContain('__nectarLiveReload');
      expect(body).toContain('WebSocket');
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);

  test('injects the external livereload script tag into served HTML', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Listening on')) break;
      }
      const match = stderr.match(/Listening on http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('/__nectar/livereload.js');
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);

  test('pushes a reload message over WebSocket when content changes', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stderr += decoder.decode(value, { stream: true });
        if (stderr.includes('Watch mode enabled')) break;
      }
      const match = stderr.match(/Listening on http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);

      // Connect a mock WS client and wait for the server to push reload after
      // we touch a content file.
      const ws = new WebSocket(`ws://localhost:${port}/__nectar_livereload`);
      const messages: string[] = [];
      const opened = new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(new Error(`ws error: ${String(e)}`));
      });
      ws.onmessage = (e) => {
        messages.push(typeof e.data === 'string' ? e.data : '<binary>');
      };
      await opened;

      // Trigger a rebuild by editing the post body.
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nUpdated body.\n',
        'utf8',
      );

      const msgDeadline = Date.now() + 10000;
      while (messages.length === 0 && Date.now() < msgDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      ws.close();

      expect(messages.length).toBeGreaterThan(0);
      const parsed = JSON.parse(messages[0] ?? '{}') as { type?: string };
      expect(parsed.type === 'reload' || parsed.type === 'css').toBe(true);
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 45000);
});

describe('cli dev — production build does NOT inject the livereload script', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDevFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('plain `nectar build` output has no /__nectar/livereload.js reference', async () => {
    const { exitCode } = await runCli(['build'], dir);
    expect(exitCode).toBe(0);
    const html = await Bun.file(join(dir, 'dist/index.html')).text();
    expect(html).not.toContain('/__nectar/livereload.js');
    expect(html).not.toContain('__nectarLiveReload');
  });
});

describe('isIgnoredChange (cli dev)', () => {
  test('ignores generated theme artifacts that the build reads back', () => {
    expect(isIgnoredChange('assets/built/source.js.map')).toBe(true);
    expect(isIgnoredChange('assets/built/screen.css')).toBe(true);
    expect(isIgnoredChange('node_modules/foo/index.js')).toBe(true);
    expect(isIgnoredChange('.DS_Store')).toBe(true);
  });

  test('allows real source files', () => {
    expect(isIgnoredChange('posts/hello.md')).toBe(false);
    expect(isIgnoredChange('index.hbs')).toBe(false);
    expect(isIgnoredChange('nectar.toml')).toBe(false);
  });
});
