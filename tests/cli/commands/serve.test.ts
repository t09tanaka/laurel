import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ServeSimulation,
  browserOpenCommand,
  collectServeSimulationHeaders,
  findServeSimulationRedirect,
  formatServeUrl,
  inferServeContentType,
  injectLiveReloadScript,
  isIgnoredChange,
  openBrowserUrl,
  parseServeHeadersArtifact,
  parseServeRedirectsArtifact,
  parseServeSimulationTarget,
} from '~/cli/commands/serve.ts';
import { LIVERELOAD_SCRIPT_PATH } from '~/dev/livereload.ts';

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

function pickPort(): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response('ok');
    },
  });
  const { port } = server;
  server.stop(true);
  if (port === undefined) throw new Error('Bun.serve did not expose an assigned port');
  return port;
}

async function waitForServe(url: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Server startup is asynchronous; retry until the deadline.
    }
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function readUntil(
  reader: { read(): Promise<{ value?: Uint8Array; done: boolean }> },
  predicate: (text: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (predicate(text)) break;
  }
  return text;
}

describe('cli serve — host binding', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serve --help advertises --host with 127.0.0.1 default and 0.0.0.0 opt-in', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--host <host>');
    expect(stdout).toContain('127.0.0.1');
    expect(stdout).toContain('0.0.0.0');
    expect(stdout).toContain('--proxy <api-base>');
    expect(stdout).toContain('--tls-cert <file>');
    expect(stdout).toContain('--tls-key <file>');
    expect(stdout).toContain('local preview server');
    expect(stdout).toContain('not for production hosting');
  });

  test('default binding is 127.0.0.1 — log line reports it explicitly', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--port', '52001', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('bound to 127.0.0.1');
    expect(stdout).toContain('local preview only, not for production hosting');
    expect(stdout).not.toContain('bound to 0.0.0.0');
  });

  test('--host 0.0.0.0 opts in to LAN exposure and is reflected in the log line', async () => {
    const { stdout, exitCode } = await runCli(
      ['serve', '--port', '52002', '--host', '0.0.0.0', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('bound to 0.0.0.0');
  });

  test('--host 127.0.0.1 is honored verbatim in the log line', async () => {
    const { stdout, exitCode } = await runCli(
      ['serve', '--port', '52003', '--host', '127.0.0.1', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('bound to 127.0.0.1');
  });

  test('rejects empty --host with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--host', '   ', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --host');
  });

  test('default port scans to the next open port when 4321 is in use', async () => {
    const blocker = Bun.serve({
      hostname: '127.0.0.1',
      port: 4321,
      fetch() {
        return new Response('busy');
      },
    });
    try {
      const { stdout, stderr, exitCode } = await runCli(['serve', '--no-watch'], dir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('http://127.0.0.1:4322/');
    } finally {
      blocker.stop(true);
    }
  });
});

describe('cli serve — proxy and TLS validation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('rejects non-http proxy URLs before starting the server', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--proxy', 'file:///tmp/api', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --proxy');
  });

  test('requires TLS cert and key together', async () => {
    const { stderr, exitCode } = await runCli(
      ['serve', '--tls-cert', 'cert.pem', '--no-watch'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--tls-cert and --tls-key');
  });

  test('formats https preview URLs when TLS is enabled', () => {
    expect(formatServeUrl('localhost', 4321, '/', 'https')).toBe('https://localhost:4321/');
  });
});

describe('cli serve — request path confinement', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('rejects encoded traversal outside dist with 403', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited.catch(() => undefined);
    }
  }, 15_000);

  test('rejects encoded Windows separators before filesystem lookup', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`${baseUrl}/..%5c..%5csecret.txt`);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited.catch(() => undefined);
    }
  }, 15_000);

  test('rejects symlinks that resolve outside dist', async () => {
    await mkdir(join(dir, 'distOther'), { recursive: true });
    await writeFile(join(dir, 'distOther/secret.txt'), 'secret');
    await symlink(join(dir, 'distOther/secret.txt'), join(dir, 'dist/secret.txt'));

    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`${baseUrl}/secret.txt`);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited.catch(() => undefined);
    }
  }, 15_000);
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
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let stdout = '';
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
        if (stdout.includes('Watch mode enabled')) break;
      }
      expect(stdout).toContain('Watch mode enabled');
      expect(proc.killed).toBe(false);
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('serve --no-watch returns immediately without engaging watchers', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--port', '52011', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Watch mode enabled');
  });
});

describe('cli serve — --open', () => {
  test('serve --help advertises the browser opener flag', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--open');
    expect(stdout).toContain('default browser');
  });

  test('formats the bound URL before opening it', () => {
    expect(formatServeUrl('localhost', 4321, '/')).toBe('http://localhost:4321/');
    expect(formatServeUrl('localhost', 4321, '/blog/')).toBe('http://localhost:4321/blog/');
  });

  test('maps supported platforms to their browser opener commands', () => {
    const url = 'http://localhost:4321/';
    expect(browserOpenCommand(url, 'darwin')).toEqual(['open', url]);
    expect(browserOpenCommand(url, 'linux')).toEqual(['xdg-open', url]);
    expect(browserOpenCommand(url, 'win32')).toEqual(['cmd', '/c', 'start', '', url]);
    expect(browserOpenCommand(url, 'freebsd')).toBeNull();
  });

  test('uses an injected opener so tests do not launch a real browser', () => {
    const calls: string[][] = [];
    const opened = openBrowserUrl('http://localhost:4321/', (command) => calls.push(command));
    expect(opened).toBe(
      process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32',
    );
    if (opened) {
      expect(calls).toHaveLength(1);
      const [command] = calls;
      expect(command?.at(-1)).toBe('http://localhost:4321/');
    } else {
      expect(calls).toEqual([]);
    }
  });
});

describe('cli serve — access logs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--verbose emits one stderr access log line per request', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, '--verbose', 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const stdoutReader = proc.stdout.getReader();
    const stderrReader = proc.stderr.getReader();
    try {
      await readUntil(stdoutReader, (stdout) => stdout.includes('Watch mode enabled'));
      const response = await fetch(`http://127.0.0.1:${port}/missing`);
      await response.text();
      expect(response.status).toBe(404);

      const stderr = await readUntil(stderrReader, (text) => /GET \/missing 404 \d+ms/.test(text));
      expect(stderr).toMatch(/GET \/missing 404 \d+ms/);
      expect(stderr.match(/GET \/missing 404 \d+ms/g)).toHaveLength(1);
    } finally {
      stdoutReader.releaseLock();
      stderrReader.releaseLock();
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('access logs stay silent without --verbose', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const stdoutReader = proc.stdout.getReader();
    const stderrReader = proc.stderr.getReader();
    try {
      await readUntil(stdoutReader, (stdout) => stdout.includes('Watch mode enabled'));
      const response = await fetch(`http://127.0.0.1:${port}/missing`);
      await response.text();
      expect(response.status).toBe(404);

      await Bun.sleep(150);
      proc.kill('SIGTERM');
      const stderr = await readUntil(stderrReader, () => false, 1000);
      expect(stderr).not.toMatch(/GET \/missing 404 \d+ms/);
    } finally {
      stdoutReader.releaseLock();
      stderrReader.releaseLock();
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });
});

describe('cli serve — compression', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
    await Bun.write(join(dir, 'dist/assets/app.css'), 'body { color: black; }\n'.repeat(50));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--compression gzip serves gzip-encoded compressible files', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      [
        'bun',
        CLI_ENTRY,
        'serve',
        '--port',
        String(port),
        '--host',
        '127.0.0.1',
        '--compression',
        'gzip',
      ],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`${baseUrl}/assets/app.css`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      await response.arrayBuffer();
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Encoding')).toBe('gzip');
      expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('returns 413 when a file exceeds the configured local response cap', async () => {
    await Bun.write(join(dir, 'dist/assets/large.txt'), 'x'.repeat(64));
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
        env: { ...process.env, NECTAR_SERVE_MAX_RESPONSE_BYTES: '32' },
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`${baseUrl}/assets/large.txt`);
      expect(response.status).toBe(413);
      expect(await response.text()).toBe('Payload Too Large');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });
});

describe('cli serve — verbose examples', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
    await Bun.write(
      join(dir, 'nectar.toml'),
      ['[site]', 'title = "x"', '', '[build]', 'base_path = "/blog/"'].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--verbose prints copy-pasteable curl examples using the base path', async () => {
    const { stdout, exitCode } = await runCli(['--verbose', 'serve', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('curl -I http://127.0.0.1:4321/blog/');
    expect(stdout).toContain('curl -I http://127.0.0.1:4321/blog/sitemap.xml');
    expect(stdout).toContain('curl -I http://127.0.0.1:4321/blog/rss.xml');
  });
});

describe('cli serve — deploy artifact simulation', () => {
  test('serve --help advertises the deploy simulation target flag', async () => {
    const { stdout, exitCode } = await runCli(['serve', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--simulate <target>');
    expect(stdout).toContain('netlify');
    expect(stdout).toContain('cloudflare-pages');
    expect(stdout).toContain('vercel');
  });

  test('rejects unknown --simulate targets with exit code 2', async () => {
    const dir = await makeServeFixture();
    try {
      const { stderr, exitCode } = await runCli(
        ['serve', '--port', '52012', '--no-watch', '--simulate', 's3'],
        dir,
      );
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Invalid --simulate value');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('parses Netlify and Cloudflare _headers / _redirects artifacts', () => {
    const headers = parseServeHeadersArtifact(
      [
        '# Generated',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
        '/*',
        '  X-Robots-Tag: noindex',
        '',
      ].join('\n'),
    );
    expect(headers).toEqual([
      {
        pattern: '/assets/*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        pattern: '/*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ]);

    const redirects = parseServeRedirectsArtifact('/old  /new  308\n/preview  /index.html  200\n');
    expect(redirects).toEqual([
      { source: '/old', destination: '/new', status: 308 },
      { source: '/preview', destination: '/index.html', status: 200 },
    ]);
  });

  test('matches simulated redirects and headers using deploy-style patterns', () => {
    const simulation: ServeSimulation = {
      target: 'netlify',
      redirects: [{ source: '/old/*', destination: '/new', status: 308 }],
      headers: [
        {
          pattern: '/assets/*',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        },
        { pattern: '/*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
      ],
    };

    expect(findServeSimulationRedirect(simulation, '/old/page')?.status).toBe(308);
    const assetHeaders = collectServeSimulationHeaders(simulation, '/assets/screen.css');
    expect(assetHeaders.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(assetHeaders.get('X-Robots-Tag')).toBe('noindex');
    expect(parseServeSimulationTarget('cloudflare')).toBe('cloudflare-pages');
  });
});

describe('cli serve — dev cache control', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
    await Bun.write(join(dir, 'dist/404.html'), '<!doctype html><title>missing</title>');
    await Bun.write(join(dir, 'dist/assets/app.css'), 'body { color: black; }');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('serves HTML, assets, fallback pages, and livereload with no-store', async () => {
    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);

      const cases = [
        ['/', 200],
        ['/assets/app.css', 200],
        ['/missing', 404],
        [LIVERELOAD_SCRIPT_PATH, 200],
      ] as const;

      for (const [path, status] of cases) {
        const response = await fetch(`${baseUrl}${path}`);
        await response.arrayBuffer();
        expect(response.status, path).toBe(status);
        expect(response.headers.get('Cache-Control'), path).toBe('no-store');
      }
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('does not overwrite simulated Cache-Control headers', async () => {
    await Bun.write(
      join(dir, 'dist/_headers'),
      ['/assets/*', '  Cache-Control: public, max-age=31536000, immutable'].join('\n'),
    );
    const port = pickPort();
    const proc = Bun.spawn(
      [
        'bun',
        CLI_ENTRY,
        'serve',
        '--port',
        String(port),
        '--host',
        '127.0.0.1',
        '--simulate',
        'netlify',
      ],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);
      const response = await fetch(`${baseUrl}/assets/app.css`);
      await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });
});

describe('cli serve — content types', () => {
  test('maps common SSG outputs to explicit Content-Type values', () => {
    expect(inferServeContentType('/dist/sitemap.xml')).toBe('application/xml');
    expect(inferServeContentType('/dist/rss.xml')).toBe('application/rss+xml');
    expect(inferServeContentType('/dist/site.webmanifest')).toBe('application/manifest+json');
    expect(inferServeContentType('/dist/assets/app.css')).toBe('text/css; charset=utf-8');
    expect(inferServeContentType('/dist/assets/app.js')).toBe(
      'application/javascript; charset=utf-8',
    );
    expect(inferServeContentType('/dist/assets/data.json')).toBe('application/json; charset=utf-8');
  });

  test('serves common SSG outputs with explicit Content-Type headers', async () => {
    const dir = await makeServeFixture();
    await Bun.write(join(dir, 'dist/sitemap.xml'), '<sitemapindex></sitemapindex>');
    await Bun.write(join(dir, 'dist/rss.xml'), '<rss></rss>');
    await Bun.write(join(dir, 'dist/site.webmanifest'), '{"name":"Nectar"}');
    await Bun.write(join(dir, 'dist/assets/app.css'), 'body { color: black; }');
    await Bun.write(join(dir, 'dist/assets/app.js'), 'console.log("ok");');
    await Bun.write(join(dir, 'dist/assets/data.json'), '{"ok":true}');

    const port = pickPort();
    const proc = Bun.spawn(
      ['bun', CLI_ENTRY, 'serve', '--port', String(port), '--host', '127.0.0.1'],
      {
        cwd: dir,
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      await waitForServe(`${baseUrl}/`);

      const cases = [
        ['/sitemap.xml', 'application/xml'],
        ['/rss.xml', 'application/rss+xml'],
        ['/site.webmanifest', 'application/manifest+json'],
        ['/assets/app.css', 'text/css; charset=utf-8'],
        ['/assets/app.js', 'application/javascript; charset=utf-8'],
        ['/assets/data.json', 'application/json; charset=utf-8'],
      ] as const;

      for (const [path, contentType] of cases) {
        const response = await fetch(`${baseUrl}${path}`);
        await response.arrayBuffer();
        expect(response.status, path).toBe(200);
        expect(response.headers.get('Content-Type'), path).toBe(contentType);
      }
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
      await rm(dir, { recursive: true, force: true });
    }
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
    const { stdout, exitCode } = await runCli(['serve', '--port', '52020', '--no-watch'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('running an initial build');
    expect(stdout).toContain('Initial build complete');
    expect(stdout).not.toContain('No build output found');
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

describe('cli serve — --port validation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeServeFixture();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('rejects non-integer --port with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '80.5', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
    expect(stderr).toContain('1..65535');
  });

  test('rejects negative / zero --port with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '0', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });

  test('rejects out-of-range --port (>65535) with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', '70000', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });

  test('rejects non-numeric --port with exit code 2', async () => {
    const { stderr, exitCode } = await runCli(['serve', '--port', 'abc', '--no-watch'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --port');
  });
});

describe('cli serve — base_path in startup log', () => {
  async function makeFixtureWithBasePath(basePath: string): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-bp-')));
    await Bun.write(
      join(dir, 'nectar.toml'),
      `[site]\ntitle = "x"\n\n[build]\nbase_path = "${basePath}"\n`,
    );
    await Bun.write(join(dir, 'dist/index.html'), '<!doctype html>ok');
    return dir;
  }

  test('subpath base_path appears in the announced URL', async () => {
    const dir = await makeFixtureWithBasePath('/blog/');
    try {
      const { stdout, exitCode } = await runCli(['serve', '--port', '52030', '--no-watch'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('http://127.0.0.1:52030/blog/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('root base_path keeps the trailing slash', async () => {
    const dir = await makeFixtureWithBasePath('/');
    try {
      const { stdout, exitCode } = await runCli(['serve', '--port', '52031', '--no-watch'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('http://127.0.0.1:52031/');
      expect(stdout).not.toContain('http://localhost:52031/blog');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli serve — --build', () => {
  async function makeFixtureWithBuiltSite(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-serve-build-')));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Force Build Test"',
        'url = "https://forcebuild.test"',
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
    // Pre-create dist/ with a stale marker so we can confirm `--build` regenerates.
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist/index.html'), 'STALE');
    return dir;
  }

  test('--build triggers a fresh build even when dist/ already exists', async () => {
    const dir = await makeFixtureWithBuiltSite();
    try {
      const { stdout, exitCode } = await runCli(
        ['serve', '--port', '52040', '--no-watch', '--build'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('--build requested');
      expect(stdout).toContain('Initial build complete');
      const rebuilt = await Bun.file(join(dir, 'dist/index.html')).text();
      expect(rebuilt).not.toBe('STALE');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('-b short form also triggers a build', async () => {
    const dir = await makeFixtureWithBuiltSite();
    try {
      const { stdout, exitCode } = await runCli(
        ['serve', '--port', '52041', '--no-watch', '-b'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('--build requested');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
    const blockerPort = blocker.port;
    if (blockerPort === undefined) throw new Error('Bun did not allocate a port');
    try {
      const { stderr, exitCode } = await runCli(
        ['serve', '--port', String(blockerPort), '--host', '127.0.0.1', '--no-watch'],
        dir,
      );
      expect(exitCode).toBe(2);
      expect(stderr).toContain(`Port ${blockerPort} is in use`);
      expect(stderr).toContain(`--port ${blockerPort + 1}`);
    } finally {
      blocker.stop(true);
    }
  });
});
