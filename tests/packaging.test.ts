import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

// Guards the npm publish surface: without a strict `files` whitelist, npm
// publishes everything not in .npmignore — which would balloon the tarball
// with example content, tests, and editor configs. See backlog task #132.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function waitForDashboardUrl(
  server: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
): Promise<string> {
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 5_000;
  let buffered = '';

  while (Date.now() < deadline) {
    const timeoutMs = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ]);
    if (result === 'timeout') break;
    if (result.done) break;

    buffered += decoder.decode(result.value, { stream: true });
    for (const line of buffered.split('\n')) {
      const match = line.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) {
        reader.releaseLock();
        return match[0];
      }
    }
  }

  reader.releaseLock();
  throw new Error(`dashboard did not report a listening URL.\nstdout:\n${buffered}`);
}

describe('packaging', () => {
  test('package.json has an explicit files whitelist', () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files.length).toBeGreaterThan(0);
  });

  test('files whitelist excludes directories that must never be published', () => {
    const forbidden = ['example', 'tests', '.claude', 'scripts', 'docs', 'provision'];
    for (const entry of pkg.files) {
      for (const dir of forbidden) {
        expect(
          entry === dir || entry.startsWith(`${dir}/`),
          `files entry "${entry}" must not include forbidden dir "${dir}"`,
        ).toBe(false);
      }
    }
  });

  test('files whitelist includes the artifacts consumers need', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('README.md');
    expect(pkg.files).toContain('LICENSE');
  });

  // Guards the programmatic API surface: downstream code (Cloudflare Pages
  // plugins, Vite integrations, etc.) needs stable subpath entries to embed
  // Laurel without reaching into private internals. See backlog task #510.
  describe('subpath exports', () => {
    type ExportEntry = string | { types?: string; default?: string };
    const exportsMap = pkg.exports as Record<string, ExportEntry>;

    test('exports map is defined as an object', () => {
      expect(typeof exportsMap).toBe('object');
      expect(exportsMap).not.toBeNull();
    });

    test('main entry resolves to the programmatic build module', () => {
      const main = exportsMap['.'];
      expect(typeof main).toBe('object');
      expect((main as { default?: string }).default).toBe('./dist/build.mjs');
      expect((main as { types?: string }).types).toBe('./dist/types/build/index.d.ts');
    });

    test('./build exposes the programmatic build entry', () => {
      const entry = exportsMap['./build'];
      expect(typeof entry).toBe('object');
      expect((entry as { default?: string }).default).toBe('./dist/build.mjs');
      expect((entry as { types?: string }).types).toBe('./dist/types/build/index.d.ts');
    });

    test('./cli exposes the CLI entry', () => {
      const entry = exportsMap['./cli'];
      expect(typeof entry).toBe('object');
      expect((entry as { default?: string }).default).toBe('./dist/cli.mjs');
      expect((entry as { types?: string }).types).toBe('./dist/types/cli/index.d.ts');
    });

    test('./types continues to expose the public type barrel', () => {
      const entry = exportsMap['./types'];
      expect(typeof entry).toBe('object');
      expect((entry as { types?: string }).types).toBe('./dist/types/types.d.ts');
    });

    // Guards against shipping raw .ts source as a runtime entry. Node consumers
    // cannot execute TypeScript directly, so every `default` condition must
    // resolve to the prepublish-compiled JS in dist/. See backlog task #134.
    test('no subpath export defaults to source files outside dist/', () => {
      for (const [subpath, entry] of Object.entries(exportsMap)) {
        if (typeof entry === 'string') continue;
        const def = entry.default;
        if (def === undefined) continue;
        expect(
          def.startsWith('./dist/'),
          `export "${subpath}" default must live under ./dist/ but was "${def}"`,
        ).toBe(true);
      }
    });

    test('./package.json is exported so tooling can read metadata', () => {
      expect(exportsMap['./package.json']).toBe('./package.json');
    });
  });

  describe('cli bundle', () => {
    test('packaged dashboard serves bundled assets from package dist/', async () => {
      const outRoot = join(REPO_ROOT, '.laurel/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-packaged-dashboard-'));
      const packageDist = join(outdir, 'package', 'dist');
      let server: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

      try {
        for (const script of ['scripts/build-dashboard-bundle.ts', 'scripts/build-cli.ts']) {
          const proc = Bun.spawn(['bun', 'run', script], {
            cwd: REPO_ROOT,
            env: { ...process.env, LAUREL_BUILD_OUTDIR: packageDist },
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);
          expect(stderr).toBe('');
          expect(exitCode, stdout).toBe(0);
        }

        const bundledCli = join(packageDist, 'cli.mjs');
        server = Bun.spawn(
          ['bun', bundledCli, 'dashboard', '--port', '0', '--host', '127.0.0.1', '--json'],
          {
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const url = await waitForDashboardUrl(server);
        const response = await fetch(new URL('/assets/dashboard.js', url));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('javascript');
        expect(await response.text()).toContain('/api/dashboard/bootstrap');
      } finally {
        if (server) {
          server.kill();
          await server.exited;
        }
        await rm(outdir, { recursive: true, force: true });
      }
    });

    test('command dispatch imports use distributable JS specifiers', async () => {
      const source = await readFile(join(REPO_ROOT, 'src/cli/index.ts'), 'utf8');

      expect(source).not.toMatch(/import\(['"]\.\/commands\/[^'"]+\.ts['"]\)/);
      expect(source).toContain("import('./commands/build.js')");
      expect(source).toContain("import('./commands/import-ghost.js')");
    });

    test('build:cli output dispatches subcommands under Node without raw .ts command imports', async () => {
      const outRoot = join(REPO_ROOT, '.laurel/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-cli-bundle-'));

      try {
        const packageDeps = pkg as {
          dependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        const external = [
          ...Object.keys(packageDeps.dependencies ?? {}),
          ...Object.keys(packageDeps.peerDependencies ?? {}),
          ...Object.keys(packageDeps.optionalDependencies ?? {}),
        ];
        const result = await Bun.build({
          entrypoints: [join(REPO_ROOT, 'src/cli/index.ts')],
          outdir,
          target: 'bun',
          format: 'esm',
          naming: { entry: 'cli.mjs' },
          external,
        });

        if (!result.success) {
          throw new Error(result.logs.map((log) => log.message).join('\n'));
        }

        const bundledCli = join(outdir, 'cli.mjs');
        const bundledSource = await readFile(bundledCli, 'utf8');
        expect(bundledSource).not.toMatch(/import\(['"]\.\/commands\/[^'"]+\.ts['"]\)/);

        const proc = Bun.spawn(['node', bundledCli, 'build', '--help'], {
          cwd: REPO_ROOT,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);

        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Build the site');
      } finally {
        await rm(outdir, { recursive: true, force: true });
      }
    });

    test('build:cli emits source maps and maps debug stacks back to TypeScript sources', async () => {
      const outRoot = join(REPO_ROOT, '.laurel/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-cli-sourcemaps-'));

      try {
        const buildProc = Bun.spawn(['bun', 'run', 'scripts/build-cli.ts'], {
          cwd: REPO_ROOT,
          env: { ...process.env, LAUREL_BUILD_OUTDIR: outdir },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
          new Response(buildProc.stdout).text(),
          new Response(buildProc.stderr).text(),
          buildProc.exited,
        ]);

        expect(buildStderr).toBe('');
        expect(buildExitCode).toBe(0);
        expect(buildStdout).toContain(`Built ${join(outdir, 'cli.mjs')}`);

        const bundledCli = join(outdir, 'cli.mjs');
        const cliMap = await readFile(`${bundledCli}.map`, 'utf8');
        expect(cliMap).toContain('src/cli/index.ts');
        expect(cliMap).toContain('src/config/loader.ts');

        const missingConfig = join(outdir, 'missing.toml');
        const outputDir = join(outdir, 'site');
        const defaultProc = Bun.spawn(
          [
            'bun',
            bundledCli,
            'build',
            '--config',
            missingConfig,
            '--output',
            outputDir,
            '--no-progress',
          ],
          {
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [defaultStderr, defaultExitCode] = await Promise.all([
          new Response(defaultProc.stderr).text(),
          defaultProc.exited,
        ]);

        expect(defaultExitCode).toBe(1);
        expect(defaultStderr).toContain('missing.toml');
        expect(defaultStderr).not.toContain('\n    at ');
        expect(defaultStderr).not.toContain('dist/cli.mjs');

        const debugProc = Bun.spawn(
          [
            'bun',
            bundledCli,
            '--debug',
            'build',
            '--config',
            missingConfig,
            '--output',
            outputDir,
            '--no-progress',
          ],
          {
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [debugStderr, debugExitCode] = await Promise.all([
          new Response(debugProc.stderr).text(),
          debugProc.exited,
        ]);

        expect(debugExitCode).toBe(1);
        expect(debugStderr).toContain('missing.toml');
        expect(debugStderr).toContain('src/config/loader.ts');
        expect(debugStderr).not.toContain(`${bundledCli}:`);
      } finally {
        await rm(outdir, { recursive: true, force: true });
      }
    });
  });
});
