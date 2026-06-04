import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChangeBus, handleDashboardRequest } from '~/cli/commands/dashboard.ts';
import { createDistZipStream } from '~/cli/dashboard/zip-writer.ts';

async function makeBuildFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-dashboard-build-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'themes/source/assets'), { recursive: true });
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "Build Site"',
      'url = "https://build.test"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
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
    [
      '---',
      'title: Hello',
      'date: 2026-01-01T00:00:00Z',
      'created_at: 2026-01-01T00:00:00Z',
      '---',
      '',
      'Hello body',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'themes/source/default.hbs'),
    '<!doctype html><html><head>{{ghost_head}}</head><body>{{{body}}}</body></html>',
    'utf8',
  );
  await writeFile(join(dir, 'themes/source/index.hbs'), '{{!< default}}<h1>Home</h1>', 'utf8');
  await writeFile(
    join(dir, 'themes/source/post.hbs'),
    '{{!< default}}<article><h1>{{title}}</h1>{{content}}</article>',
    'utf8',
  );
  await writeFile(
    join(dir, 'themes/source/page.hbs'),
    '{{!< default}}<article><h1>{{title}}</h1>{{content}}</article>',
    'utf8',
  );
  await writeFile(join(dir, 'themes/source/assets/app.css'), 'body{color:#111}', 'utf8');
  return dir;
}

async function readNdjsonStream<T>(response: Response): Promise<T[]> {
  if (!response.body) throw new Error('response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) events.push(JSON.parse(line) as T);
      nl = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer.trim()) as T);
  return events;
}

interface BuildEvent {
  type: 'start' | 'progress' | 'done' | 'error';
  message?: string;
  summary?: {
    routeCount: number;
    assetCount: number;
    outputBytes?: number;
    durationMs: number;
  };
}

describe('dashboard build + export endpoints', () => {
  test('POST /api/build streams progress and emits a done event with summary', async () => {
    const dir = await makeBuildFixture();
    try {
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/build', { method: 'POST' }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/x-ndjson');
      const events = await readNdjsonStream<BuildEvent>(response);
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('start');
      expect(types).toContain('progress');
      expect(types[types.length - 1]).toBe('done');
      const done = events[events.length - 1];
      if (!done?.summary) throw new Error('expected done summary');
      expect(done.summary.routeCount).toBeGreaterThan(0);
      expect(done.summary.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('GET /api/build/export.zip returns 404 before any build runs', async () => {
    const dir = await makeBuildFixture();
    try {
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/build/export.zip'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toContain('Build site button');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('GET /api/build/export.zip returns a valid zip after a build', async () => {
    const dir = await makeBuildFixture();
    try {
      const build = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/build', { method: 'POST' }),
        { cwd: dir, changeBus: createChangeBus() },
      );
      // Drain the build stream so the mutex releases before we ask for the zip.
      await readNdjsonStream<BuildEvent>(build);

      const exportResponse = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/build/export.zip'),
        { cwd: dir, changeBus: createChangeBus() },
      );
      expect(exportResponse.status).toBe(200);
      expect(exportResponse.headers.get('content-type')).toBe('application/zip');
      expect(exportResponse.headers.get('content-disposition')).toContain('attachment');

      const buf = new Uint8Array(await exportResponse.arrayBuffer());
      // Local file header magic.
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
      expect(buf[2]).toBe(0x03);
      expect(buf[3]).toBe(0x04);
      // End-of-central-directory magic at the tail (last 22 bytes for a
      // comment-free EOCD).
      const tail = buf.slice(buf.length - 22);
      expect(tail[0]).toBe(0x50);
      expect(tail[1]).toBe(0x4b);
      expect(tail[2]).toBe(0x05);
      expect(tail[3]).toBe(0x06);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('zip writer', () => {
  test('round-trips a directory of small text files through the system unzip', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-zip-writer-')));
    const outZip = join(dir, 'out.zip');
    const source = join(dir, 'source');
    const restored = join(dir, 'restored');
    try {
      await mkdir(join(source, 'nested'), { recursive: true });
      await writeFile(join(source, 'top.txt'), 'top-level content\n', 'utf8');
      await writeFile(join(source, 'nested/inner.html'), '<h1>Inner</h1>\n', 'utf8');
      // Add some compressible payload to exercise the deflate path.
      const repeats = 'abcdef'.repeat(200);
      await writeFile(join(source, 'nested/repeat.txt'), repeats, 'utf8');

      const stream = createDistZipStream(source);
      const buf = new Uint8Array(await new Response(stream).arrayBuffer());
      await Bun.write(outZip, buf);

      // Decompress with the system unzip so we exercise a real ZIP parser
      // rather than re-using our writer's assumptions.
      await mkdir(restored, { recursive: true });
      const unzip = Bun.spawn(['unzip', '-q', outZip, '-d', restored], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await unzip.exited;
      expect(code).toBe(0);
      expect(await Bun.file(join(restored, 'top.txt')).text()).toBe('top-level content\n');
      expect(await Bun.file(join(restored, 'nested/inner.html')).text()).toBe('<h1>Inner</h1>\n');
      expect(await Bun.file(join(restored, 'nested/repeat.txt')).text()).toBe(repeats);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
