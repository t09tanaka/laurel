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
});
