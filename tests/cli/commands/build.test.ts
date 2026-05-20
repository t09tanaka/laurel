import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDryRunRouteTable, isIgnoredChange } from '~/cli/commands/build.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: env ? { ...process.env, ...env } : undefined,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-')));
  for (const [path, body] of Object.entries(files)) {
    await Bun.write(join(dir, path), body);
  }
  return dir;
}

describe('nectar build exit codes', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns 2 on usage error (unknown flag)', async () => {
    const dir = await makeFixture({ 'nectar.toml': '[site]\ntitle = "x"\n' });
    cleanups.push(dir);
    const result = await runCli(['build', '--no-such-flag'], dir);
    expect(result.exitCode).toBe(2);
  });

  test('returns 3 on config error (invalid TOML)', async () => {
    const dir = await makeFixture({ 'nectar.toml': 'this is = not = valid TOML\n' });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(3);
  });

  test('returns 5 on theme error (missing theme directory)', async () => {
    const dir = await makeFixture({
      'nectar.toml': '[site]\ntitle = "x"\n\n[theme]\nname = "does-not-exist"\ndir = "themes"\n',
    });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(5);
  });
});

async function makeDryRunFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-dryrun-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await Bun.write(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Dry Run Test"',
      'url = "https://dryrun.test"',
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
  );
  await Bun.write(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
  );
  await Bun.write(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n');
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
  return dir;
}

async function makePreviewFeedFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-preview-feeds-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await Bun.write(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Preview Feed Test"',
      'url = "https://prod.example.com"',
      '',
      '[theme]',
      'dir = "themes"',
      'name = "source"',
      '',
    ].join('\n'),
  );
  await Bun.write(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
  );
  await Bun.write(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n');
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
  return dir;
}

describe('nectar build --dry-run (#252)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('--dry-run exits 0 and never writes dist/', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Dry run: would build');
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });

  test('--dry-run without --verbose suppresses the per-route table', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Routes:');
    expect(result.stderr).not.toContain('TEMPLATE');
  });

  test('--dry-run --verbose prints the per-route table', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['--verbose', 'build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Routes:');
    expect(result.stderr).toContain('TEMPLATE');
    expect(result.stderr).toContain('URL');
    expect(result.stderr).toContain('/hello/');
  });

  test('prints plain build phase and route progress when stderr is piped', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Build: Loading config...');
    expect(result.stderr).toContain('Build: Loading content and theme...');
    expect(result.stderr).toContain('Build: planned ');
    expect(result.stderr).toContain('Build: rendered [1/');
    expect(result.stderr).toContain('Build: finished rendering ');
    expect(result.stderr).toContain('Dry run: would build');
  });

  test('--no-progress suppresses build progress and summary lines', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run', '--no-progress'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Build:');
    expect(result.stderr).not.toContain('Dry run: would build');
  });

  test('--json suppresses human progress while keeping JSON summary on stdout', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build', '--dry-run', '--json'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Build:');
    expect(result.stderr).not.toContain('Dry run: would build');
    const payload = JSON.parse(result.stdout) as { ok: boolean; dryRun: boolean };
    expect(payload.ok).toBe(true);
    expect(payload.dryRun).toBe(true);
  });

  test('--quiet suppresses build progress output', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['--quiet', 'build', '--dry-run'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Build:');
    expect(result.stderr).not.toContain('Dry run: would build');
  });
});

describe('nectar build base URL precedence', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes provider preview URLs into RSS and sitemap absolute URLs', async () => {
    const cases: {
      name: string;
      env: Record<string, string>;
      previewUrl: string;
    }[] = [
      {
        name: 'Netlify deploy preview',
        env: {
          NETLIFY: 'true',
          CONTEXT: 'deploy-preview',
          DEPLOY_PRIME_URL: 'https://deploy-preview-42--site.netlify.app',
        },
        previewUrl: 'https://deploy-preview-42--site.netlify.app',
      },
      {
        name: 'Cloudflare Pages',
        env: {
          CF_PAGES: '1',
          CF_PAGES_URL: 'https://feature-docs.example.pages.dev',
        },
        previewUrl: 'https://feature-docs.example.pages.dev',
      },
      {
        name: 'Vercel',
        env: {
          VERCEL: '1',
          VERCEL_URL: 'feature-docs-git-main-team.vercel.app',
        },
        previewUrl: 'https://feature-docs-git-main-team.vercel.app',
      },
    ];

    for (const { name, env, previewUrl } of cases) {
      const dir = await makePreviewFeedFixture();
      cleanups.push(dir);

      const result = await runCli(['build'], dir, env);
      expect(result.exitCode, name).toBe(0);

      const rss = readFileSync(join(dir, 'dist/rss.xml'), 'utf8');
      expect(rss, name).toContain(`<link>${previewUrl}/hello/</link>`);
      expect(rss, name).toContain(`href="${previewUrl}/rss.xml"`);
      expect(rss, name).not.toContain('https://prod.example.com');

      const sitemapIndex = readFileSync(join(dir, 'dist/sitemap.xml'), 'utf8');
      expect(sitemapIndex, name).toContain(`<loc>${previewUrl}/sitemap-posts.xml</loc>`);
      expect(sitemapIndex, name).not.toContain('https://prod.example.com');

      const sitemapPosts = readFileSync(join(dir, 'dist/sitemap-posts.xml'), 'utf8');
      expect(sitemapPosts, name).toContain(`<loc>${previewUrl}/hello/</loc>`);
      expect(sitemapPosts, name).not.toContain('https://prod.example.com');
    }
  });

  test('uses Netlify preview URL below --base-url and above configured site.url', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);

    const netlify = {
      NETLIFY: 'true',
      CONTEXT: 'deploy-preview',
      DEPLOY_PRIME_URL: 'https://deploy-preview-42--site.netlify.app',
    };
    const automatic = await runCli(['build'], dir, netlify);
    expect(automatic.exitCode).toBe(0);
    const automaticHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(automaticHtml).toContain('https://deploy-preview-42--site.netlify.app/hello/');
    expect(automaticHtml).not.toContain('https://dryrun.test/hello/');

    const explicit = await runCli(
      ['build', '--base-url', 'https://cli-preview.example'],
      dir,
      netlify,
    );
    expect(explicit.exitCode).toBe(0);
    const explicitHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(explicitHtml).toContain('https://cli-preview.example/hello/');
    expect(explicitHtml).not.toContain('deploy-preview-42--site.netlify.app');
  });

  test('keeps NECTAR_BUILD_BASE_URL ahead of Netlify preview URL', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const result = await runCli(['build'], dir, {
      NETLIFY: 'true',
      CONTEXT: 'branch-deploy',
      DEPLOY_PRIME_URL: 'https://branch--site.netlify.app',
      NECTAR_BUILD_BASE_URL: 'https://build-env.example',
    });
    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(html).toContain('https://build-env.example/hello/');
    expect(html).not.toContain('branch--site.netlify.app');
  });

  test('uses Cloudflare Pages URL below explicit env and CLI base URL overrides', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const cloudflare = {
      CF_PAGES: '1',
      CF_PAGES_URL: 'https://feature-docs.example.pages.dev',
    };

    const automatic = await runCli(['build'], dir, cloudflare);
    expect(automatic.exitCode).toBe(0);
    const automaticHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(automaticHtml).toContain('https://feature-docs.example.pages.dev/hello/');
    expect(automaticHtml).not.toContain('https://dryrun.test/hello/');

    const explicitEnv = await runCli(['build'], dir, {
      ...cloudflare,
      NECTAR_SITE_URL: 'https://explicit-env.example',
    });
    expect(explicitEnv.exitCode).toBe(0);
    const explicitEnvHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(explicitEnvHtml).toContain('https://explicit-env.example/hello/');
    expect(explicitEnvHtml).not.toContain('feature-docs.example.pages.dev');

    const cli = await runCli(['build', '--base-url', 'https://cli-preview.example'], dir, {
      ...cloudflare,
      NECTAR_SITE_URL: 'https://explicit-env.example',
    });
    expect(cli.exitCode).toBe(0);
    const cliHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(cliHtml).toContain('https://cli-preview.example/hello/');
    expect(cliHtml).not.toContain('explicit-env.example');
    expect(cliHtml).not.toContain('feature-docs.example.pages.dev');
  });

  test('uses Vercel URL below explicit env and CLI base URL overrides', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);
    const vercel = {
      VERCEL: '1',
      VERCEL_URL: 'feature-docs-git-main-team.vercel.app',
    };

    const automatic = await runCli(['build'], dir, vercel);
    expect(automatic.exitCode).toBe(0);
    const automaticHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(automaticHtml).toContain('https://feature-docs-git-main-team.vercel.app/hello/');
    expect(automaticHtml).not.toContain('https://dryrun.test/hello/');

    const buildEnv = await runCli(['build'], dir, {
      ...vercel,
      NECTAR_BUILD_BASE_URL: 'https://build-env.example',
    });
    expect(buildEnv.exitCode).toBe(0);
    const buildEnvHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(buildEnvHtml).toContain('https://build-env.example/hello/');
    expect(buildEnvHtml).not.toContain('feature-docs-git-main-team.vercel.app');

    const explicitEnv = await runCli(['build'], dir, {
      ...vercel,
      NECTAR_SITE_URL: 'https://explicit-env.example',
    });
    expect(explicitEnv.exitCode).toBe(0);
    const explicitEnvHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(explicitEnvHtml).toContain('https://explicit-env.example/hello/');
    expect(explicitEnvHtml).not.toContain('feature-docs-git-main-team.vercel.app');

    const cli = await runCli(['build', '--base-url', 'https://cli-preview.example'], dir, {
      ...vercel,
      NECTAR_BUILD_BASE_URL: 'https://build-env.example',
      NECTAR_SITE_URL: 'https://explicit-env.example',
    });
    expect(cli.exitCode).toBe(0);
    const cliHtml = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(cliHtml).toContain('https://cli-preview.example/hello/');
    expect(cliHtml).not.toContain('build-env.example');
    expect(cliHtml).not.toContain('explicit-env.example');
    expect(cliHtml).not.toContain('feature-docs-git-main-team.vercel.app');
  });
});

describe('nectar build preview noindex protection', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('injects robots noindex meta and Netlify-compatible headers on deploy previews', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);

    const result = await runCli(['build'], dir, {
      NETLIFY: 'true',
      CONTEXT: 'deploy-preview',
      DEPLOY_PRIME_URL: 'https://deploy-preview-42--site.netlify.app',
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex">');

    const headers = readFileSync(join(dir, 'dist/_headers'), 'utf8');
    expect(headers).toContain('/*\n');
    expect(headers).toContain('X-Robots-Tag: noindex');
  });

  test('injects robots noindex meta and Vercel headers on Vercel previews', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);

    const result = await runCli(['build'], dir, {
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'feature-docs-git-main-team.vercel.app',
      VERCEL_GIT_COMMIT_REF: 'feature/docs',
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex">');

    const vercel = JSON.parse(readFileSync(join(dir, 'dist/vercel.json'), 'utf8')) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const catchAll = vercel.headers?.find((rule) => rule.source === '/(.*)');
    expect(catchAll?.headers).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex' });
  });

  test('injects robots noindex meta and Cloudflare Pages headers on branch previews', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);

    const result = await runCli(['build'], dir, {
      CF_PAGES: '1',
      CF_PAGES_URL: 'https://feature-docs.example.pages.dev',
      CF_PAGES_BRANCH: 'feature/docs',
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex">');

    const headers = readFileSync(join(dir, 'dist/_headers'), 'utf8');
    expect(headers).toContain('/*\n');
    expect(headers).toContain('X-Robots-Tag: noindex');
  });

  test('does not inject noindex markers for production Netlify builds', async () => {
    const dir = await makeDryRunFixture();
    cleanups.push(dir);

    const result = await runCli(['build'], dir, {
      NETLIFY: 'true',
      CONTEXT: 'production',
      DEPLOY_PRIME_URL: 'https://production-deploy.netlify.app',
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(join(dir, 'dist/hello/index.html'), 'utf8');
    expect(html).not.toContain('<meta name="robots" content="noindex">');

    const headers = readFileSync(join(dir, 'dist/_headers'), 'utf8');
    expect(headers).not.toContain('X-Robots-Tag');
  });
});

describe('formatDryRunRouteTable', () => {
  test('renders aligned columns including a header row', () => {
    const out = formatDryRunRouteTable([
      {
        url: '/',
        outputPath: 'index.html',
        template: 'home.hbs',
        kind: 'home',
        bytes: 1234,
        reused: false,
      },
      {
        url: '/post-with-a-long-slug/',
        outputPath: 'post-with-a-long-slug/index.html',
        template: 'post.hbs',
        kind: 'post',
        bytes: 56789,
        reused: false,
      },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Routes:');
    expect(lines[1]).toContain('KIND');
    expect(lines[1]).toContain('URL');
    expect(lines[1]).toContain('TEMPLATE');
    expect(lines[1]).toContain('BYTES');
    expect(lines[1]).toContain('OUTPUT');
    expect(lines[2]).toContain('home');
    expect(lines[2]).toContain('1234');
    expect(lines[3]).toContain('/post-with-a-long-slug/');
    expect(lines[3]).toContain('56789');
  });

  test('handles an empty route list', () => {
    expect(formatDryRunRouteTable([])).toBe('Routes: (none)');
  });
});

describe('nectar build --include-drafts (#253)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeSiteWithDraft(): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-drafts-')));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Drafts"',
        'url = "https://drafts.test"',
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
      join(dir, 'content/posts/wip.md'),
      `---
title: WIP
status: draft
date: 2026-02-01T00:00:00Z
---

Not ready.
`,
      'utf8',
    );
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('--include-drafts flag emits the "Building with drafts" warning', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build', '--include-drafts'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Building with drafts');
  });

  test('NECTAR_DRAFTS=1 env alias also opts in', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build'], dir, { NECTAR_DRAFTS: '1' });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Building with drafts');
  });

  test('without the flag, drafts are silently excluded (no warning)', async () => {
    const dir = await makeSiteWithDraft();
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Building with drafts');
  });
});

async function makeWatchFixture(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-watch-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await Bun.write(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Watch Test"',
      'url = "https://watch.test"',
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
  );
  await Bun.write(
    join(dir, 'content/posts/hello.md'),
    '---\ntitle: "Hello"\ndate: 2026-01-01T00:00:00Z\n---\n\nBody\n',
  );
  await Bun.write(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n');
  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
  return dir;
}

describe('nectar build --watch (#254)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  test('--help advertises --watch', async () => {
    const { stdout, exitCode } = await runCli(['build', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--watch');
    expect(stdout).toContain('100ms debounce');
  });

  test('--watch and --dry-run together exit 2 (usage)', async () => {
    const dir = await makeFixture({ 'nectar.toml': '[site]\ntitle = "x"\n' });
    cleanups.push(dir);
    const { stderr, exitCode } = await runCli(['build', '--watch', '--dry-run'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('--watch and --dry-run are mutually exclusive');
  });

  test('--watch runs the initial build, prints Built, and stays alive', async () => {
    const dir = await makeWatchFixture();
    cleanups.push(dir);
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'build', '--watch'], {
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
      expect(stderr).toContain('Built');
      expect(stderr).toContain('Watch mode enabled');
      expect(proc.killed).toBe(false);
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });

  test('--watch rebuilds when a post changes', async () => {
    const dir = await makeWatchFixture();
    cleanups.push(dir);
    const proc = Bun.spawn(['bun', CLI_ENTRY, 'build', '--watch'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let stderr = '';
      const readUntil = async (needle: string, timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (stderr.includes(needle)) return true;
          const { value, done } = await reader.read();
          if (done) return stderr.includes(needle);
          stderr += decoder.decode(value, { stream: true });
        }
        return stderr.includes(needle);
      };
      const ready = await readUntil('Watch mode enabled', 15000);
      expect(ready).toBe(true);
      const before = stderr.length;
      await writeFile(
        join(dir, 'content/posts/hello.md'),
        '---\ntitle: "Hello v2"\ndate: 2026-01-01T00:00:00Z\n---\n\nUpdated\n',
        'utf8',
      );
      const rebuilt = await readUntil('Rebuilt', 15000);
      expect(rebuilt).toBe(true);
      expect(stderr.slice(before)).toContain('Rebuilt');
      reader.releaseLock();
    } finally {
      proc.kill('SIGTERM');
      await proc.exited;
    }
  });
});

describe('nectar build --emit-content-api (#214)', () => {
  const cleanups: string[] = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const dir = cleanups.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeSite(opts: { contentApiEnabled: boolean }): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-build-emit-capi-')));
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await mkdir(join(dir, 'content/authors'), { recursive: true });
    await writeFile(
      join(dir, 'nectar.toml'),
      [
        '[site]',
        'title = "Emit CAPI"',
        'url = "https://emit-capi.test"',
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
        '[components.content_api]',
        `enabled = ${opts.contentApiEnabled}`,
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(dir, 'content/posts/hello.md'),
      '---\ntitle: Hello\ndate: 2026-01-01T00:00:00Z\n---\n\nhi\n',
      'utf8',
    );
    const themeSrc = join(process.cwd(), 'example/themes/source');
    await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });
    return dir;
  }

  test('--emit-content-api forces shadows ON even when config disables them', async () => {
    const dir = await makeSite({ contentApiEnabled: false });
    cleanups.push(dir);
    const result = await runCli(['build', '--emit-content-api'], dir);
    expect(result.exitCode).toBe(0);
    // Shadow tree (api.ts) and flat dump (content-api.ts) both materialise.
    expect(existsSync(join(dir, 'dist', 'content', 'posts.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'content', 'posts', 'index.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'ghost', 'api', 'content', 'posts.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'ghost', 'api', 'content', 'posts', 'index.json'))).toBe(
      true,
    );
  });

  test('NECTAR_BUILD_EMIT_CONTENT_API=0 forces shadows OFF even when config enables them', async () => {
    const dir = await makeSite({ contentApiEnabled: true });
    cleanups.push(dir);
    const result = await runCli(['build'], dir, { NECTAR_BUILD_EMIT_CONTENT_API: '0' });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, 'dist', 'content', 'posts.json'))).toBe(false);
    expect(existsSync(join(dir, 'dist', 'ghost', 'api', 'content', 'posts.json'))).toBe(false);
  });

  test('no flag and no env var: respects the config value (default true)', async () => {
    const dir = await makeSite({ contentApiEnabled: true });
    cleanups.push(dir);
    const result = await runCli(['build'], dir);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, 'dist', 'content', 'posts.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist', 'content', 'posts', 'index.json'))).toBe(true);
  });

  test('--help advertises --emit-content-api', async () => {
    const dir = await makeFixture({});
    cleanups.push(dir);
    const { stdout } = await runCli(['build', '--help'], dir);
    expect(stdout).toContain('--emit-content-api');
  });
});

describe('isIgnoredChange (build --watch)', () => {
  test('ignores generated theme artifacts and editor noise', () => {
    expect(isIgnoredChange('assets/built/source.js.map')).toBe(true);
    expect(isIgnoredChange('assets/built/screen.css')).toBe(true);
    expect(isIgnoredChange('node_modules/foo/index.js')).toBe(true);
    expect(isIgnoredChange('.DS_Store')).toBe(true);
    expect(isIgnoredChange('partials/.hidden.hbs')).toBe(true);
    expect(isIgnoredChange('post.hbs~')).toBe(true);
    expect(isIgnoredChange('foo.swp')).toBe(true);
  });

  test('allows real source files', () => {
    expect(isIgnoredChange('posts/hello.md')).toBe(false);
    expect(isIgnoredChange('index.hbs')).toBe(false);
    expect(isIgnoredChange('locales/en.json')).toBe(false);
    expect(isIgnoredChange('nectar.toml')).toBe(false);
  });
});
