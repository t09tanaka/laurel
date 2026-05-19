import { describe, expect, test } from 'bun:test';
import pkg from '../package.json' with { type: 'json' };

// Guards the npm publish surface: without a strict `files` whitelist, npm
// publishes everything not in .npmignore — which would balloon the tarball
// with example content, tests, and editor configs. See backlog task #132.

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
});
