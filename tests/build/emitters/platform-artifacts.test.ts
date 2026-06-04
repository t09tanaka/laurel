import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

type DeployTarget =
  | 'cloudflare_pages'
  | 'cloudflare_workers'
  | 'netlify'
  | 'vercel'
  | 'apache'
  | 'firebase';

async function makeSiteWithDeployTarget(target: DeployTarget): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `laurel-emitter-${target}-`));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'laurel.toml'),
    [
      '[site]',
      `title = "${target} emitter"`,
      `url = "https://${target.replace(/_/g, '-')}.test"`,
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
      `[deploy.${target}]`,
      'enabled = true',
      '',
      '[deploy.headers.security]',
      'custom = { X-Test-Emitter = "integration" }',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(dir, 'content/posts/hello.md'),
    ['---', 'title: "Hello"', 'date: 2026-01-01T00:00:00Z', '---', '', 'Body', ''].join('\n'),
    'utf8',
  );
  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');
  await writeFile(join(dir, 'redirects.yaml'), '- from: /old\n  to: /new\n  status: 308\n', 'utf8');

  await cp(join(process.cwd(), 'example/themes/source'), join(dir, 'themes/source'), {
    recursive: true,
  });

  return dir;
}

describe('deploy emitter integration outputs (#347)', () => {
  test('Cloudflare Pages build emits _headers and _redirects at the publish root', async () => {
    const cwd = await makeSiteWithDeployTarget('cloudflare_pages');
    const summary = await build({ cwd });

    const headers = await readFile(join(summary.outputDir, '_headers'), 'utf8');
    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(headers).toContain('X-Test-Emitter: integration');

    const redirects = await readFile(join(summary.outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain('/old  /new  308');
  });

  test('Cloudflare Workers build emits target-aware manifest headers and redirects', async () => {
    const cwd = await makeSiteWithDeployTarget('cloudflare_workers');
    const summary = await build({ cwd });

    const body = JSON.parse(
      await readFile(join(summary.outputDir, '_routes-manifest.json'), 'utf8'),
    ) as {
      redirects: Array<{ source: string; destination: string; status: number }>;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    expect(body.headers).toContainEqual(
      expect.objectContaining({
        source: '/assets/*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      }),
    );
    expect(body.headers).toContainEqual(
      expect.objectContaining({
        source: '/*',
        headers: expect.arrayContaining([{ key: 'X-Test-Emitter', value: 'integration' }]),
      }),
    );
    expect(body.redirects).toContainEqual({ source: '/old', destination: '/new', status: 308 });
  });

  test('Netlify build emits _headers and preserves force redirects syntax', async () => {
    const cwd = await makeSiteWithDeployTarget('netlify');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      '- from: /old\n  to: /new\n  status: 301\n  force: true\n',
    );

    const summary = await build({ cwd });

    const headers = await readFile(join(summary.outputDir, '_headers'), 'utf8');
    expect(headers).toContain('/content/images/*');
    expect(headers).toContain('X-Test-Emitter: integration');

    const redirects = await readFile(join(summary.outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain('/old  /new  301!');
  });

  test('Netlify build can add opt-in Early Hints Link headers and route artifacts', async () => {
    const cwd = await makeSiteWithDeployTarget('netlify');
    await writeFile(
      join(cwd, 'laurel.toml'),
      [
        await readFile(join(cwd, 'laurel.toml'), 'utf8'),
        '',
        '[deploy.early_hints]',
        'enabled = true',
        '',
      ].join('\n'),
      'utf8',
    );

    const summary = await build({ cwd });

    const headers = await readFile(join(summary.outputDir, '_headers'), 'utf8');
    expect(headers).toContain('/\n  Link: </assets/built/screen.');
    expect(headers).toContain(
      '; rel=preload; as=style; crossorigin="anonymous"; integrity="sha384-',
    );

    const artifact = JSON.parse(
      await readFile(join(summary.outputDir, 'early-hints.json'), 'utf8'),
    ) as { route: string; links: Array<{ href: string; as: string }> };
    expect(artifact.route).toBe('/');
    expect(artifact.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringMatching(/^\/assets\/built\/screen\.[a-f0-9]+\.css$/),
          as: 'style',
        }),
      ]),
    );
  });

  test('Vercel build emits a vercel.json with headers and redirects', async () => {
    const cwd = await makeSiteWithDeployTarget('vercel');
    const summary = await build({ cwd });

    const body = JSON.parse(await readFile(join(summary.outputDir, 'vercel.json'), 'utf8')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      redirects: Array<{ source: string; destination: string; statusCode: number }>;
    };

    expect(body.headers).toContainEqual(
      expect.objectContaining({
        source: '/(.*)',
        headers: expect.arrayContaining([{ key: 'X-Test-Emitter', value: 'integration' }]),
      }),
    );
    expect(body.redirects).toContainEqual({
      source: '/old',
      destination: '/new',
      statusCode: 308,
    });
  });

  test('Apache build emits .htaccess with redirects, headers, and clean URL rewrites', async () => {
    const cwd = await makeSiteWithDeployTarget('apache');
    const summary = await build({ cwd });

    const body = await readFile(join(summary.outputDir, '.htaccess'), 'utf8');
    expect(body).toContain('RewriteRule ^old$ /new [R=308,L]');
    expect(body).toContain('Header always set X-Test-Emitter "integration"');
    expect(body).toContain('RewriteRule ^(.+[^/])$ $1/index.html [L]');
  });

  test('Firebase Hosting build emits firebase.json with hosting headers and redirects', async () => {
    const cwd = await makeSiteWithDeployTarget('firebase');
    const summary = await build({ cwd });

    const body = JSON.parse(await readFile(join(summary.outputDir, 'firebase.json'), 'utf8')) as {
      hosting: {
        public: string;
        cleanUrls: boolean;
        trailingSlash?: boolean;
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
        redirects: Array<{ source: string; destination: string; type: number }>;
        rewrites: Array<{ source: string; destination: string }>;
      };
    };

    expect(body.hosting.public).toBe('.');
    expect(body.hosting.cleanUrls).toBe(true);
    expect(body.hosting.trailingSlash).toBe(true);
    expect(body.hosting.headers).toContainEqual(
      expect.objectContaining({
        source: '**',
        headers: expect.arrayContaining([{ key: 'X-Test-Emitter', value: 'integration' }]),
      }),
    );
    expect(body.hosting.redirects).toContainEqual({
      source: '/old',
      destination: '/new',
      type: 308,
    });
    expect(body.hosting.rewrites).toEqual([]);
  });
});
