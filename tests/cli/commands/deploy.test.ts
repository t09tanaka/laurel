import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

async function writeDeployBuildManifest(dir: string): Promise<void> {
  await mkdir(join(dir, 'dist/.nectar'), { recursive: true });
  await writeFile(
    join(dir, 'dist/.nectar/manifest.json'),
    `${JSON.stringify(
      {
        schema_version: 2,
        generated_at: '2026-05-21T00:00:00.000Z',
        nectar: { version: '0.1.0' },
        theme: {
          name: 'test-theme',
          version: '1.0.0',
          fingerprint: 'theme',
          custom_settings: {},
        },
        config_hash: 'config',
        hash_algorithm: 'sha256',
        route_count: 1,
        asset_count: 1,
        routes: [],
        files: [
          { path: 'assets/app.css', size: 18, hash: 'css-hash' },
          { path: 'index.html', size: 30, hash: 'html-hash' },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(dir, 'dist/.nectar/changed-paths.txt'), '/\n/index.html\n/assets/app.css\n');
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
    expect(stdout).toContain('--preflight');
    expect(stdout).toContain('--build');
  });

  test('missing target prints usage error', async () => {
    const { stderr, exitCode } = await runCli(['deploy'], undefined, {
      // Explicitly clear auto-detect env vars so the test is hermetic across
      // CI providers (Actions sets GITHUB_ACTIONS=true; Netlify, Vercel,
      // Cloudflare each set their own).
      NETLIFY: '',
      VERCEL: '',
      CF_PAGES: '',
      GITHUB_ACTIONS: '',
    });
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

  test('dry-run prints target file list and last-build diff from the build manifest', async () => {
    const dir = await makeFixtureWithDist();
    await writeDeployBuildManifest(dir);
    try {
      const { stdout, exitCode } = await runCli(['deploy', '--target=netlify', '--dry-run'], dir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('netlify deploy');
      expect(stdout).toContain('Files to deploy for netlify (2):');
      expect(stdout).toContain('  assets/app.css (18 B)');
      expect(stdout).toContain('  index.html (30 B)');
      expect(stdout).toContain('Changed since previous build (3):');
      expect(stdout).toContain('  /index.html');
      expect(stdout).toContain('  /assets/app.css');
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

  test('s3 --dry-run with --preflight prints the bucket policy status command', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(
        [
          'deploy',
          's3',
          '--dry-run',
          '--preflight',
          '--bucket',
          'my-bucket',
          '--region',
          'us-west-2',
        ],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('aws s3 sync');
      expect(stdout).toContain('Preflight check: aws s3api get-bucket-policy-status');
      expect(stdout).toContain('--bucket my-bucket');
      expect(stdout).toContain('--region us-west-2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('s3 --dry-run uploads precompressed sidecars with content encoding', async () => {
    const dir = await makeFixtureWithDist();
    try {
      await writeFile(join(dir, 'dist/index.html.br'), 'brotli-body');
      await writeFile(join(dir, 'dist/assets.css.gz'), 'gzip-body');

      const { stdout, exitCode } = await runCli(
        ['deploy', 's3', '--dry-run', '--bucket', 'my-bucket', '--region', 'us-west-2'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('aws s3 sync');
      expect(stdout).toContain("--exclude '*.br' --exclude '*.gz'");
      expect(stdout).toContain(
        `aws s3 cp ${join(dir, 'dist/assets.css.gz')} s3://my-bucket/assets.css.gz --content-encoding gzip --content-type 'text/css; charset=utf-8' --region us-west-2`,
      );
      expect(stdout).toContain(
        `aws s3 cp ${join(dir, 'dist/index.html.br')} s3://my-bucket/index.html.br --content-encoding br --content-type 'text/html; charset=utf-8' --region us-west-2`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('s3 --dry-run deletes stale remote sidecars when delete is enabled', async () => {
    const dir = await makeFixtureWithDist(['', '[deploy.s3]', 'delete = true']);
    try {
      await writeFile(join(dir, 'dist/index.html.br'), 'brotli-body');

      const { stdout, exitCode } = await runCli(
        ['deploy', 's3', '--dry-run', '--bucket', 'my-bucket'],
        dir,
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain(
        "aws s3 rm s3://my-bucket --recursive --exclude '*' --include '*.br' --include '*.gz'",
      );
      expect(stdout).toContain(
        `aws s3 cp ${join(dir, 'dist/index.html.br')} s3://my-bucket/index.html.br --content-encoding br --content-type 'text/html; charset=utf-8'`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('s3 --preflight warns when the bucket policy is public', async () => {
    const dir = await makeFixtureWithDist();
    const binDir = join(dir, 'bin');
    const callsPath = join(dir, 'aws-calls.txt');
    try {
      await mkdir(binDir, { recursive: true });
      const awsPath = join(binDir, 'aws');
      await writeFile(
        awsPath,
        [
          '#!/bin/sh',
          'printf "%s\\n" "$*" >> "$NECTAR_AWS_CALLS"',
          'if [ "$1" = "s3api" ]; then',
          '  printf \'{"PolicyStatus":{"IsPublic":true}}\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "s3" ]; then',
          '  exit 0',
          'fi',
          'exit 64',
          '',
        ].join('\n'),
      );
      await chmod(awsPath, 0o755);
      const { stderr, exitCode } = await runCli(
        ['deploy', 's3', '--preflight', '--bucket', 'my-bucket', '--region', 'us-west-2'],
        dir,
        {
          AWS_PROFILE: 'test',
          NECTAR_AWS_CALLS: callsPath,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
        },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain('public bucket policy');
      const calls = await readFile(callsPath, 'utf8');
      expect(calls).toContain(
        's3api get-bucket-policy-status --bucket my-bucket --output json --region us-west-2',
      );
      expect(calls).toContain('s3 sync');
      expect(calls).toContain('s3://my-bucket');
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

  test('auto-detects netlify from NETLIFY env when target is "auto"', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stdout, exitCode } = await runCli(['deploy', 'auto', '--dry-run'], dir, {
        NETLIFY: 'true',
        VERCEL: '',
        CF_PAGES: '',
        GITHUB_ACTIONS: '',
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('netlify deploy');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('auto-detects cloudflare from CF_PAGES env with [deploy.cloudflare] configured', async () => {
    const dir = await makeFixtureWithDist(['[deploy.cloudflare]', 'project_name = "auto-cf"', '']);
    try {
      const { stdout, stderr, exitCode } = await runCli(['deploy', '--dry-run'], dir, {
        NETLIFY: '',
        VERCEL: '',
        CF_PAGES: '1',
        GITHUB_ACTIONS: '',
      });
      if (exitCode !== 0) {
        throw new Error(`auto-detect cloudflare failed (${exitCode}): ${stderr}\n${stdout}`);
      }
      expect(exitCode).toBe(0);
      expect(stdout).toContain('wrangler pages deploy');
      expect(stdout).toContain('--project-name=auto-cf');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('auto target with no signal exits with a usage hint', async () => {
    const dir = await makeFixtureWithDist();
    try {
      const { stderr, exitCode } = await runCli(['deploy', 'auto', '--dry-run'], dir, {
        NETLIFY: '',
        VERCEL: '',
        CF_PAGES: '',
        GITHUB_ACTIONS: '',
      });
      expect(exitCode).toBe(2);
      expect(stderr).toContain('auto-detect');
      expect(stderr).toContain('NETLIFY');
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
