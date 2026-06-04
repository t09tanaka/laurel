import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer } from '~/cli/commands/dashboard.ts';

async function makeMinimalProject(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-dashboard-dev-')));
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
      'title = "Dev Mode Smoke"',
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

describe('laurel dashboard --dev', () => {
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

  test('binds and answers core routes in dev mode', async () => {
    const handle = await startDashboardServer({
      cwd: projectDir,
      port: 0,
      host: '127.0.0.1',
      mode: 'dev',
    });
    try {
      const base = `http://127.0.0.1:${handle.port}`;

      const root = await fetch(`${base}/`);
      expect(root.status).toBe(200);
      const rootHtml = await root.text();
      expect(rootHtml).toContain('<div id="root"></div>');

      const bootstrap = await fetch(`${base}/api/dashboard/bootstrap`);
      expect(bootstrap.status).toBe(200);
      const body = (await bootstrap.json()) as { token: string; mode: string };
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
      expect(body.mode).toBe('dev');

      const state = await fetch(`${base}/api/state`);
      expect(state.status).toBe(200);
      const stateBody = (await state.json()) as { site: { title: string } };
      expect(stateBody.site.title).toBe('Dev Mode Smoke');
    } finally {
      await handle.stop();
    }
  });
});
