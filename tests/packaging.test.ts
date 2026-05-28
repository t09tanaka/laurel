import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import {
  generateHomebrewFormula,
  normalizeHomebrewVersion,
  parseHomebrewShasums,
} from '../scripts/generate-homebrew-formula.ts';
import {
  generateScoopManifest,
  normalizeScoopVersion,
  parseScoopShasums,
} from '../scripts/generate-scoop-manifest.ts';

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
  // Nectar without reaching into private internals. See backlog task #510.
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
      const outRoot = join(REPO_ROOT, '.nectar/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-packaged-dashboard-'));
      const packageDist = join(outdir, 'package', 'dist');
      let server: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

      try {
        for (const script of ['scripts/build-dashboard-bundle.ts', 'scripts/build-cli.ts']) {
          const proc = Bun.spawn(['bun', 'run', script], {
            cwd: REPO_ROOT,
            env: { ...process.env, NECTAR_BUILD_OUTDIR: packageDist },
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

    test('compiled binary serves embedded dashboard assets', async () => {
      const outRoot = join(REPO_ROOT, '.nectar/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-compiled-dashboard-'));
      const binary = join(outdir, process.platform === 'win32' ? 'nectar.exe' : 'nectar');
      let server: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;

      try {
        const compile = Bun.spawn(
          ['bun', 'build', '--compile', '--outfile', binary, 'src/cli/index.ts'],
          {
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(compile.stdout).text(),
          new Response(compile.stderr).text(),
          compile.exited,
        ]);
        expect(stderr).toBe('');
        expect(exitCode, stdout).toBe(0);

        server = Bun.spawn([binary, 'dashboard', '--port', '0', '--host', '127.0.0.1', '--json'], {
          cwd: REPO_ROOT,
          stdout: 'pipe',
          stderr: 'pipe',
        });
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
      const outRoot = join(REPO_ROOT, '.nectar/cache');
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
      const outRoot = join(REPO_ROOT, '.nectar/cache');
      await mkdir(outRoot, { recursive: true });
      const outdir = await mkdtemp(join(outRoot, 'test-cli-sourcemaps-'));

      try {
        const buildProc = Bun.spawn(['bun', 'run', 'scripts/build-cli.ts'], {
          cwd: REPO_ROOT,
          env: { ...process.env, NECTAR_BUILD_OUTDIR: outdir },
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

  describe('Docker image release', () => {
    test('root Dockerfile builds a Bun alpine CLI image for nectar build', async () => {
      const body = await readFile(join(REPO_ROOT, 'Dockerfile'), 'utf8');

      expect(body).toContain('FROM oven/bun:${BUN_VERSION}-alpine AS deps');
      expect(body).toContain('FROM oven/bun:${BUN_VERSION}-alpine AS prod-deps');
      expect(body).toContain('RUN bun run build:cli');
      expect(body).toContain('RUN bun install --frozen-lockfile --production');
      expect(body).toContain('WORKDIR /workspace');
      expect(body).toContain('RUN ln -s /opt/nectar/dist/cli.mjs /usr/local/bin/nectar');
      expect(body).toContain('ENTRYPOINT ["nectar", "build"]');
    });

    test('root dockerignore keeps local-only and generated files out of the image context', async () => {
      const body = await readFile(join(REPO_ROOT, '.dockerignore'), 'utf8');
      const entries = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

      expect(entries).toContain('.git/');
      expect(entries).toContain('.worktrees/');
      expect(entries).toContain('node_modules/');
      expect(entries).toContain('dist/');
      expect(entries).toContain('.nectar/');
      expect(entries).toContain('.nectar-cache/');
    });

    test('release workflow publishes multi-arch images to GHCR and Docker Hub on tags', async () => {
      const body = await readFile(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

      expect(body).toContain('publish-docker:');
      expect(body).toContain('packages: write');
      expect(body).toContain('uses: docker/setup-qemu-action@v4');
      expect(body).toContain('uses: docker/setup-buildx-action@v4');
      expect(body).toContain('registry: ghcr.io');
      expect(body).toContain('DOCKERHUB_USERNAME');
      expect(body).toContain('DOCKERHUB_TOKEN');
      expect(body).toContain('ghcr.io/${{ github.repository }}');
      expect(body).toContain('docker.io/${{ secrets.DOCKERHUB_USERNAME }}/nectar');
      expect(body).toContain('platforms: linux/amd64,linux/arm64');
      expect(body).toContain('push: true');
      expect(body).toContain('type=raw,value=${{ needs.resolve-ref.outputs.tag }}');
      expect(body).toContain(
        'type=semver,pattern={{version}},value=${{ needs.resolve-ref.outputs.tag }}',
      );
    });

    test('Docker docs document the published image and required Docker Hub secrets', async () => {
      const deployDocs = await readFile(join(REPO_ROOT, 'docs', 'deploy', 'docker.md'), 'utf8');
      const recipeDocs = await readFile(join(REPO_ROOT, 'docs', 'deployment', 'docker.md'), 'utf8');

      expect(deployDocs).toContain('ghcr.io/t09tanaka/nectar:latest');
      expect(deployDocs).toContain('t09tanaka/nectar:latest');
      expect(deployDocs).toContain('DOCKERHUB_USERNAME');
      expect(deployDocs).toContain('DOCKERHUB_TOKEN');
      expect(deployDocs).toContain('nectar build');
      expect(recipeDocs).toContain('ghcr.io/t09tanaka/nectar:latest');
    });
  });

  describe('Homebrew tap formula', () => {
    const hashes = {
      darwinArm64: 'a'.repeat(64),
      darwinX64: 'b'.repeat(64),
      linuxArm64: 'c'.repeat(64),
      linuxX64: 'd'.repeat(64),
      windowsX64: 'e'.repeat(64),
    };

    const shasums = [
      `${hashes.darwinArm64}  nectar-darwin-arm64`,
      `${hashes.darwinX64}  nectar-darwin-x64`,
      `${hashes.linuxArm64}  nectar-linux-arm64`,
      `${hashes.linuxX64}  nectar-linux-x64`,
      `${hashes.windowsX64}  nectar-windows-x64.exe`,
    ].join('\n');

    test('normalizes release tags for formula versions', () => {
      expect(normalizeHomebrewVersion('v1.2.3')).toBe('1.2.3');
      expect(normalizeHomebrewVersion('1.2.3')).toBe('1.2.3');
      expect(() => normalizeHomebrewVersion('latest')).toThrow('Invalid release version');
    });

    test('parses release SHASUMS256.txt entries', () => {
      const parsed = parseHomebrewShasums(shasums);

      expect(parsed.get('nectar-darwin-arm64')).toBe(hashes.darwinArm64);
      expect(parsed.get('nectar-linux-x64')).toBe(hashes.linuxX64);
      expect(parsed.get('nectar-windows-x64.exe')).toBe(hashes.windowsX64);
    });

    test('generates an installable formula from the release template', async () => {
      const template = await readFile(
        join(REPO_ROOT, 'packaging', 'homebrew', 'Formula', 'nectar.rb.template'),
        'utf8',
      );
      const formula = generateHomebrewFormula({
        version: 'v1.2.3',
        shasumsText: shasums,
        templateText: template,
      });

      expect(formula).toContain('class Nectar < Formula');
      expect(formula).toContain('version "1.2.3"');
      expect(formula).toContain(
        'url "https://github.com/t09tanaka/nectar/releases/download/v#{version}/nectar-darwin-arm64"',
      );
      expect(formula).toContain(`sha256 "${hashes.darwinArm64}"`);
      expect(formula).toContain(`sha256 "${hashes.linuxX64}"`);
      expect(formula).toContain('bin.install artifact => "nectar"');
      expect(formula).toContain('system "#{bin}/nectar", "--help"');
      expect(formula).not.toContain('{{');
    });

    test('refuses to generate a formula without all Homebrew platform hashes', async () => {
      const template = await readFile(
        join(REPO_ROOT, 'packaging', 'homebrew', 'Formula', 'nectar.rb.template'),
        'utf8',
      );

      expect(() =>
        generateHomebrewFormula({
          version: 'v1.2.3',
          shasumsText: `${hashes.darwinArm64}  nectar-darwin-arm64\n`,
          templateText: template,
        }),
      ).toThrow('Missing Homebrew artifact checksums');
    });

    test('release workflow publishes the generated formula as a release asset', async () => {
      const workflow = await readFile(
        join(REPO_ROOT, '.github', 'workflows', 'release.yml'),
        'utf8',
      );

      expect(workflow).toContain('Generate Homebrew formula');
      expect(workflow).toContain('scripts/generate-homebrew-formula.ts');
      expect(workflow).toContain('--output release/nectar.rb');
      expect(workflow).toContain('ruby -c release/nectar.rb');
      expect(workflow).toContain('gh release create "$TAG_NAME"');
      expect(workflow).toContain('release/*');
    });

    test('release workflow opens a Homebrew tap bump pull request', async () => {
      const workflow = await readFile(
        join(REPO_ROOT, '.github', 'workflows', 'release.yml'),
        'utf8',
      );

      expect(workflow).toContain('bump-homebrew-tap:');
      expect(workflow).toContain('uses: Homebrew/actions/setup-homebrew@main');
      expect(workflow).toContain('HOMEBREW_TAP_REPOSITORY: t09tanaka/homebrew-nectar');
      expect(workflow).toContain('HOMEBREW_TAP_TOKEN');
      expect(workflow).toContain('--output ../homebrew-nectar/Formula/nectar.rb');
      expect(workflow).toContain('brew audit --strict --online --formula Formula/nectar.rb');
      expect(workflow).toContain('gh pr create');
    });

    test('docs show the tap command that enables brew install nectar', async () => {
      const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');
      const releaseDocs = await readFile(join(REPO_ROOT, 'docs', 'release.md'), 'utf8');
      const tapDocs = await readFile(
        join(REPO_ROOT, 'packaging', 'homebrew-tap', 'README.md'),
        'utf8',
      );

      expect(readme).toContain('brew tap t09tanaka/nectar');
      expect(readme).toContain('brew install nectar');
      expect(releaseDocs).toContain('t09tanaka/homebrew-nectar');
      expect(releaseDocs).toContain('bun run homebrew:formula');
      expect(releaseDocs).toContain('bump-homebrew-tap');
      expect(tapDocs).toContain('Formula/nectar.rb');
      expect(tapDocs).toContain('HOMEBREW_TAP_TOKEN');
    });
  });

  describe('Scoop bucket manifest', () => {
    const hashes = {
      darwinArm64: 'a'.repeat(64),
      darwinX64: 'b'.repeat(64),
      linuxArm64: 'c'.repeat(64),
      linuxX64: 'd'.repeat(64),
      windowsX64: 'e'.repeat(64),
    };

    const shasums = [
      `${hashes.darwinArm64}  nectar-darwin-arm64`,
      `${hashes.darwinX64}  nectar-darwin-x64`,
      `${hashes.linuxArm64}  nectar-linux-arm64`,
      `${hashes.linuxX64}  nectar-linux-x64`,
      `${hashes.windowsX64}  nectar-windows-x64.exe`,
    ].join('\n');

    test('normalizes release tags for manifest versions', () => {
      expect(normalizeScoopVersion('v1.2.3')).toBe('1.2.3');
      expect(normalizeScoopVersion('1.2.3')).toBe('1.2.3');
      expect(() => normalizeScoopVersion('nightly')).toThrow('Invalid release version');
    });

    test('parses release SHASUMS256.txt entries', () => {
      const parsed = parseScoopShasums(shasums);

      expect(parsed.get('nectar-windows-x64.exe')).toBe(hashes.windowsX64);
      expect(parsed.get('nectar-linux-x64')).toBe(hashes.linuxX64);
    });

    test('generates an installable manifest from the release template', async () => {
      const template = await readFile(
        join(REPO_ROOT, 'packaging', 'scoop', 'bucket', 'nectar.json.template'),
        'utf8',
      );
      const manifest = generateScoopManifest({
        version: 'v1.2.3',
        shasumsText: shasums,
        templateText: template,
      });
      const parsed = JSON.parse(manifest) as {
        version: string;
        architecture: { '64bit': { url: string; hash: string; bin: string[][] } };
      };

      expect(parsed.version).toBe('1.2.3');
      expect(parsed.architecture['64bit'].url).toBe(
        'https://github.com/t09tanaka/nectar/releases/download/v1.2.3/nectar-windows-x64.exe',
      );
      expect(parsed.architecture['64bit'].hash).toBe(hashes.windowsX64);
      expect(parsed.architecture['64bit'].bin).toEqual([['nectar-windows-x64.exe', 'nectar']]);
      expect(manifest).toContain('"checkver"');
      expect(manifest).toContain('"autoupdate"');
      expect(manifest).not.toContain('{{');
    });

    test('refuses to generate a manifest without the Windows checksum', async () => {
      const template = await readFile(
        join(REPO_ROOT, 'packaging', 'scoop', 'bucket', 'nectar.json.template'),
        'utf8',
      );

      expect(() =>
        generateScoopManifest({
          version: 'v1.2.3',
          shasumsText: `${hashes.linuxX64}  nectar-linux-x64\n`,
          templateText: template,
        }),
      ).toThrow('Missing Scoop artifact checksum');
    });

    test('release workflow publishes the generated manifest as a release asset', async () => {
      const workflow = await readFile(
        join(REPO_ROOT, '.github', 'workflows', 'release.yml'),
        'utf8',
      );

      expect(workflow).toContain('Generate Scoop manifest');
      expect(workflow).toContain('scripts/generate-scoop-manifest.ts');
      expect(workflow).toContain('--output release/nectar.json');
      expect(workflow).toContain('JSON.parse(await Bun.file("release/nectar.json").text())');
      expect(workflow).toContain('gh release create "$TAG_NAME"');
      expect(workflow).toContain('release/*');
    });

    test('docs show the bucket command that enables scoop install nectar', async () => {
      const readme = await readFile(join(REPO_ROOT, 'README.md'), 'utf8');
      const releaseDocs = await readFile(join(REPO_ROOT, 'docs', 'release.md'), 'utf8');

      expect(readme).toContain('scoop bucket add nectar https://github.com/t09tanaka/scoop-nectar');
      expect(readme).toContain('scoop install nectar');
      expect(releaseDocs).toContain('t09tanaka/scoop-nectar');
      expect(releaseDocs).toContain('bun run scoop:manifest');
    });
  });

  describe('AUR and Nix templates', () => {
    test('AUR template packages Linux release binaries', async () => {
      const template = await readFile(
        join(REPO_ROOT, 'packaging', 'aur', 'PKGBUILD.template'),
        'utf8',
      );

      expect(template).toContain('pkgname=nectar-bin');
      expect(template).toContain('source_x86_64=');
      expect(template).toContain('nectar-linux-x64');
      expect(template).toContain('source_aarch64=');
      expect(template).toContain('nectar-linux-arm64');
      expect(template).toContain('install -Dm755');
      expect(template).toContain('/usr/bin/nectar');
    });

    test('Nix flake template wraps Linux release binaries', async () => {
      const flake = await readFile(join(REPO_ROOT, 'packaging', 'nix', 'flake.nix'), 'utf8');

      expect(flake).toContain('x86_64-linux');
      expect(flake).toContain('aarch64-linux');
      expect(flake).toContain('nectar-linux-x64');
      expect(flake).toContain('nectar-linux-arm64');
      expect(flake).toContain('install -Dm755 "$src" "$out/bin/nectar"');
      expect(flake).toContain('"$out/bin/nectar" --help');
    });

    test('docs describe downstream AUR and Nix ownership', async () => {
      const integrations = await readFile(join(REPO_ROOT, 'docs', 'integrations.md'), 'utf8');
      const aur = await readFile(join(REPO_ROOT, 'packaging', 'aur', 'README.md'), 'utf8');
      const nix = await readFile(join(REPO_ROOT, 'packaging', 'nix', 'README.md'), 'utf8');

      expect(integrations).toContain('AUR packages');
      expect(integrations).toContain('Nix flakes');
      expect(aur).toContain('PKGBUILD.template');
      expect(nix).toContain('flake.nix');
    });
  });
});
