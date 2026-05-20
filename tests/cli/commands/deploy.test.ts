import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    env: { ...process.env, ...(env ?? {}) },
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

async function makeFixtureWithDist(extraConfig: string[] = []): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-deploy-')));
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Deploy Test"',
      'url = "https://deploy.test"',
      'locale = "en-US"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
      ...extraConfig,
    ].join('\n'),
  );
  // Mock the build outputs: dist/ with a manifest and a single html file.
  await mkdir(join(dir, 'dist'), { recursive: true });
  await writeFile(join(dir, 'dist/index.html'), '<!doctype html><title>x</title>');
  await writeFile(
    join(dir, 'dist/.nectar-manifest.json'),
    JSON.stringify({ version: 1, routes: [] }),
  );
  return dir;
}

describe('cli deploy', () => {
  test('--help advertises supported targets and --dry-run', async () => {
    const { stdout, exitCode } = await runCli(['deploy', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('cloudflare');
    expect(stdout).toContain('netlify');
    expect(stdout).toContain('vercel');
    expect(stdout).toContain('github-pages');
    expect(stdout).toContain('s3');
    expect(stdout).toContain('r2');
    expect(stdout).toContain('rsync');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--build');
  });

  test('missing target prints usage error', async () => {
    const { stderr, exitCode } = await runCli(['deploy']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument');
  });

  test('unknown target prints usage error', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stderr, exitCode } = await runCli(['deploy', 'gcs'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown deploy target');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses to deploy when dist/ does not exist', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-deploy-empty-')));
    try {
      await writeFile(
        join(dir, 'nectar.toml'),
        ['[site]', 'title = "x"', 'url = "https://example.test"', ''].join('\n'),
      );
      const { stderr, exitCode } = await runCli(
        ['deploy', 'cloudflare', '--dry-run', '--project-name', 'p'],
        dir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain('dist/ does not exist');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses to deploy when manifest is missing even if dist/ exists', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-deploy-nomani-')));
    try {
      await writeFile(
        join(dir, 'nectar.toml'),
        ['[site]', 'title = "x"', 'url = "https://example.test"', ''].join('\n'),
      );
      await mkdir(join(dir, 'dist'), { recursive: true });
      await writeFile(join(dir, 'dist/index.html'), 'x');
      const { stderr, exitCode } = await runCli(
        ['deploy', 'cloudflare', '--dry-run', '--project-name', 'p'],
        dir,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain('No build manifest');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('cloudflare --dry-run prints the wrangler command without spawning', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(
        ['deploy', 'cloudflare', '--dry-run', '--project-name', 'my-site'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('wrangler pages deploy');
      expect(stdout).toContain('--project-name=my-site');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('cloudflare fails when no project name is configured or provided', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stderr, exitCode } = await runCli(['deploy', 'cloudflare', '--dry-run'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('project name');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('netlify --dry-run prints the netlify command without spawning', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(['deploy', 'netlify', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('netlify deploy');
      expect(stdout).toContain('--dir');
      expect(stdout).toContain('--prod');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('vercel --dry-run prints the vercel command without spawning', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(['deploy', 'vercel', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('vercel deploy');
      expect(stdout).toContain('--prod');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('s3 --dry-run prints aws s3 sync without spawning', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(
        ['deploy', 's3', '--dry-run', '--bucket', 'my-bucket', '--region', 'us-west-2'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('aws s3 sync');
      expect(stdout).toContain('s3://my-bucket');
      expect(stdout).toContain('--region us-west-2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('s3 fails when no bucket is configured or provided', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stderr, exitCode } = await runCli(['deploy', 's3', '--dry-run'], dir);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('bucket');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('r2 requires both bucket and endpoint', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stderr: noBucket, exitCode: c1 } = await runCli(['deploy', 'r2', '--dry-run'], dir);
      expect(c1).toBe(2);
      expect(noBucket).toContain('bucket');
      const { stderr: noEndpoint, exitCode: c2 } = await runCli(
        ['deploy', 'r2', '--dry-run', '--bucket', 'b'],
        dir,
      );
      expect(c2).toBe(2);
      expect(noEndpoint).toContain('endpoint');
      const { stdout, exitCode: c3 } = await runCli(
        [
          'deploy',
          'r2',
          '--dry-run',
          '--bucket',
          'b',
          '--endpoint',
          'https://acct.r2.cloudflarestorage.com',
        ],
        dir,
      );
      expect(c3).toBe(0);
      expect(stdout).toContain('aws s3 sync');
      expect(stdout).toContain('s3://b');
      expect(stdout).toContain('--endpoint-url');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rsync --dry-run prints the rsync command with default flags', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(
        ['deploy', 'rsync', '--dry-run', '--destination', 'user@host:/var/www/site/'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rsync');
      expect(stdout).toContain('-avz');
      expect(stdout).toContain('--delete');
      expect(stdout).toContain('user@host:/var/www/site/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('github-pages --dry-run prints a git push plan', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(['deploy', 'github-pages', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('git push');
      expect(stdout).toContain('gh-pages');
      expect(stdout).toContain('origin');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reads project_name from [deploy.cloudflare] when --project-name is omitted', async () => {
    const dir = await makeFixtureWithDist([
      '[deploy.cloudflare]',
      'project_name = "from-config"',
      'branch = "preview"',
      '',
    ]);
    try {
      const { stdout, exitCode } = await runCli(['deploy', 'cloudflare', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('--project-name=from-config');
      expect(stdout).toContain('--branch=preview');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli deploy --build', () => {
  test('--build chains a build before deploying so a missing dist/ is repopulated', async () => {
    // Use the bundled example/ as the build source. Confirm `--build` runs the
    // pipeline before the pre-flight `dist/` + manifest check by deleting any
    // pre-existing dist first; if the chain wasn't wired, the pre-flight would
    // fail with "dist/ does not exist" before dry-run printed anything.
    const example = fileURLToPath(new URL('../../../example/', import.meta.url));
    // Clean any stale dist from a previous test run so the assertion is real.
    await rm(join(example, 'dist'), { recursive: true, force: true });
    try {
      const { stdout, stderr, exitCode } = await runCli(
        ['deploy', 'cloudflare', '--dry-run', '--build', '--project-name', 'cf-chain'],
        example,
      );
      if (exitCode !== 0) {
        throw new Error(`deploy --build failed (${exitCode}): ${stderr}`);
      }
      expect(stdout).toContain('wrangler pages deploy');
      expect(stdout).toContain('--project-name=cf-chain');
    } finally {
      // Leave dist behind for other tests that might want it.
    }
  }, 60_000);
});
