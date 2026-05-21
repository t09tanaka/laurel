import { describe, expect, test } from 'bun:test';

const themeDevDoc = new URL('../../docs/THEME_DEV.md', import.meta.url);
const threatModelDoc = new URL('../../docs/security/threat-model.md', import.meta.url);

describe('security docs: third-party theme dependency installs (#1146)', () => {
  test('theme developer guide documents the untrusted theme install workflow', async () => {
    const doc = await Bun.file(themeDevDoc).text();

    expect(doc).toContain('Installing third-party theme dependencies');
    expect(doc).toContain('Package-manager lifecycle hooks');
    expect(doc).toContain('npm install --ignore-scripts');
    expect(doc).toContain('yarn install --ignore-scripts');
    expect(doc).toContain('bun install --ignore-scripts');
    expect(doc).toContain('gulpfile.js');
    expect(doc).toContain('yarn.lock');
  });

  test('threat model flags theme build files as install-time code', async () => {
    const doc = await Bun.file(threatModelDoc).text();

    expect(doc).toContain('Install untrusted theme dependencies with lifecycle scripts disabled');
    expect(doc).toContain('package.json');
    expect(doc).toContain('gulpfile.js');
    expect(doc).toContain('yarn.lock');
    expect(doc).toContain('--ignore-scripts');
  });
});
