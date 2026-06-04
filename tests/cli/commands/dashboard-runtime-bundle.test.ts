import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer } from '~/cli/commands/dashboard.ts';

async function makeMinimalProject(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-dashboard-rtbundle-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'themes/source'), { recursive: true });
  await writeFile(join(dir, 'themes/source/index.hbs'), '<h1>{{@site.title}}</h1>\n', 'utf8');
  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      'title = "RT Bundle"',
      'description = ""',
      'url = "https://example.test"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

describe('dashboard runtime bundle override', () => {
  let originalCwd: string;
  let projectDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    projectDir = await makeMinimalProject();
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
  });

  test('serves a runtime override for /assets/dashboard.js and .css', async () => {
    const handle = await startDashboardServer({
      cwd: projectDir,
      port: 0,
      host: '127.0.0.1',
      mode: 'prod',
      runtimeBundleAssets: {
        '/assets/dashboard.js': {
          contentType: 'application/javascript; charset=utf-8',
          body: 'console.log("override-js")',
        },
        '/assets/dashboard.css': {
          contentType: 'text/css; charset=utf-8',
          body: '.override{}',
        },
      },
    });
    try {
      const base = `http://127.0.0.1:${handle.port}`;
      const js = await fetch(`${base}/assets/dashboard.js`);
      expect(js.status).toBe(200);
      expect(await js.text()).toBe('console.log("override-js")');
      const css = await fetch(`${base}/assets/dashboard.css`);
      expect(css.status).toBe(200);
      expect(await css.text()).toBe('.override{}');
    } finally {
      await handle.stop();
    }
  });

  test('falls back to the embedded bundle when no override is supplied', async () => {
    const handle = await startDashboardServer({
      cwd: projectDir,
      port: 0,
      host: '127.0.0.1',
      mode: 'prod',
    });
    try {
      const base = `http://127.0.0.1:${handle.port}`;
      const js = await fetch(`${base}/assets/dashboard.js`);
      // Embedded bundle resolves to 200 in a built checkout, or the documented
      // 503 empty-bundle response — never 404.
      expect([200, 503]).toContain(js.status);
    } finally {
      await handle.stop();
    }
  });
});
