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

async function readUntil(
  stream: ReadableStream<Uint8Array>,
  marker: string,
  timeoutMs: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const timeout = Symbol('timeout');
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remainingMs = Math.max(0, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), remainingMs)),
      ]);
      if (chunk === timeout) break;
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
      if (output.includes(marker)) break;
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function makeDevFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-dev-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
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
        const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
        expect(stdout).toContain('Laurel');
        expect(stdout).toContain('Ready in');
        // --port 0 → kernel picks a real port; the announced URL must contain
        // a concrete (non-zero) port so users can actually visit it.
        const match = stdout.match(/http:\/\/localhost:(\d+)/);
        expect(match).not.toBeNull();
        if (match !== null) {
          const announcedPort = Number(match[1]);
          expect(announcedPort).toBeGreaterThan(0);
        }
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
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      expect(stdout).toContain('Laurel');
      expect(stdout).toContain('dev mode');
      expect(stdout).toContain('Watching:');
      expect(stdout).toContain('Ready in');
      expect(stdout).toMatch(/http:\/\/localhost:\d+/);
      expect(proc.killed).toBe(false);
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);

  test('serves the livereload client script at /__laurel/livereload.js', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);
      const res = await fetch(`http://localhost:${port}/__laurel/livereload.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('javascript');
      const body = await res.text();
      expect(body).toContain('__laurelLiveReload');
      expect(body).toContain('WebSocket');
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
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('/__laurel/livereload.js');
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
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);

      // Connect a mock WS client and wait for the server to push reload after
      // we touch a content file.
      const ws = new WebSocket(`ws://localhost:${port}/__laurel_livereload`);
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
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 45000);
});

async function makeDevFixtureWithBasePath(basePath: string): Promise<string> {
  const dir = await makeDevFixture();
  // Append a [build] base_path on top of the standard fixture config.
  const tomlPath = join(dir, 'laurel.toml');
  const existing = await Bun.file(tomlPath).text();
  await writeFile(tomlPath, `${existing}\n[build]\nbase_path = "${basePath}"\n`, 'utf8');
  return dir;
}

describe('cli dev — base_path is forced to / (served from root)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDevFixtureWithBasePath('/blog/');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('announces the root URL and notes base_path is ignored', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      const match = stdout.match(/http:\/\/localhost:(\d+)(\/\S*)?/);
      expect(match).not.toBeNull();
      if (match === null) return;
      // The announced URL must be the bare root, never the /blog/ subpath.
      expect(match[2] ?? '/').toBe('/');
      // The notice explains that the configured base_path is dropped in dev.
      expect(stdout).toContain('base_path');
      expect(stdout).toContain('ignored in dev');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);

  test('serves / with 200 and emits root-relative (not /blog/) links', async () => {
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'dev', '--port', '0'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const stdout = await readUntil(proc.stdout, 'Ready in', 15_000);
      const match = stdout.match(/http:\/\/localhost:(\d+)/);
      expect(match).not.toBeNull();
      if (match === null) return;
      const port = Number(match[1]);

      const rootRes = await fetch(`http://localhost:${port}/`);
      expect(rootRes.status).toBe(200);
      const html = await rootRes.text();
      // Asset/links are root-relative; nothing should carry the /blog/ prefix.
      expect(html).toContain('/assets/');
      expect(html).not.toContain('/blog/');

      // The /blog/ subpath the config would have used is not mounted in dev.
      const subRes = await fetch(`http://localhost:${port}/blog/`);
      expect(subRes.status).toBe(404);
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  }, 30000);
});

describe('cli dev — production build does NOT inject the livereload script', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeDevFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('plain `laurel build` output has no /__laurel/livereload.js reference', async () => {
    const { exitCode } = await runCli(['build'], dir);
    expect(exitCode).toBe(0);
    const html = await Bun.file(join(dir, 'dist/index.html')).text();
    expect(html).not.toContain('/__laurel/livereload.js');
    expect(html).not.toContain('__laurelLiveReload');
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
    expect(isIgnoredChange('laurel.toml')).toBe(false);
  });
});
