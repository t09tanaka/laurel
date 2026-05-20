import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

// Guards the npm publish surface: without a strict `files` whitelist, npm
// publishes everything not in .npmignore — which would balloon the tarball
// with example content, tests, and editor configs. See backlog task #132.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
    test('command dispatch imports use distributable JS specifiers', async () => {
      const source = await readFile(join(REPO_ROOT, 'src/cli/index.ts'), 'utf8');

      expect(source).not.toMatch(/import\(['"]\.\/commands\/[^'"]+\.ts['"]\)/);
      expect(source).toContain("import('./commands/build.js')");
      expect(source).toContain("import('./commands/import-ghost.js')");
    });

    test('build:cli output dispatches subcommands under Node without raw .ts command imports', async () => {
      const outRoot = join(REPO_ROOT, '.nectar-cache');
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
      expect(entries).toContain('.nectar-cache/');
    });

    test('release workflow publishes multi-arch images to GHCR and Docker Hub on tags', async () => {
      const body = await readFile(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

      expect(body).toContain('publish-docker:');
      expect(body).toContain('packages: write');
      expect(body).toContain('uses: docker/setup-qemu-action@v3');
      expect(body).toContain('uses: docker/setup-buildx-action@v3');
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
});
