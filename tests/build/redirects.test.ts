import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collapseRedirects, loadRedirects } from '~/build/redirects.ts';

async function makeTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('loadRedirects', () => {
  test('returns [] when neither redirects.yaml nor redirects.yml exists', async () => {
    const cwd = await makeTmp('laurel-redirects-missing-');
    expect(await loadRedirects(cwd)).toEqual([]);
  });

  test('parses redirects.yaml and defaults `force` to false', async () => {
    const cwd = await makeTmp('laurel-redirects-default-force-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /old', '  to: /new', '  status: 301'].join('\n'),
    );
    expect(await loadRedirects(cwd)).toEqual([
      { from: '/old', to: '/new', status: 301, force: false },
    ]);
  });

  test('honors an explicit `force: true` flag', async () => {
    const cwd = await makeTmp('laurel-redirects-force-true-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /a', '  to: /b', '  status: 302', '  force: true'].join('\n'),
    );
    expect(await loadRedirects(cwd)).toEqual([{ from: '/a', to: '/b', status: 302, force: true }]);
  });

  test('rejects unsupported status codes', async () => {
    const cwd = await makeTmp('laurel-redirects-bad-status-');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /x\n  to: /y\n  status: 200\n');
    await expect(loadRedirects(cwd)).rejects.toThrow(/Invalid redirects\.yaml/);
  });

  test('rejects unknown fields under .strict()', async () => {
    const cwd = await makeTmp('laurel-redirects-unknown-field-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /a', '  to: /b', '  permanent: true'].join('\n'),
    );
    await expect(loadRedirects(cwd)).rejects.toThrow(/Invalid redirects\.yaml/);
  });

  test('rejects non-boolean force values', async () => {
    const cwd = await makeTmp('laurel-redirects-bad-force-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /a', '  to: /b', '  force: yes'].join('\n'),
    );
    await expect(loadRedirects(cwd)).rejects.toThrow(/Invalid redirects\.yaml/);
  });
});

describe('collapseRedirects', () => {
  test('preserves the `force` flag of the first occurrence', () => {
    const out = collapseRedirects([
      { from: '/a', to: '/A', status: 301, force: true },
      { from: '/a', to: '/A2', status: 302, force: false },
    ]);
    expect(out).toEqual([{ from: '/a', to: '/A', status: 301, force: true }]);
  });
});
