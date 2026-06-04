import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitRedirectsComponent, formatRedirectsFile } from '~/build/redirects-emit.ts';
import {
  loadAllRedirects,
  loadGhostStyleRedirects,
  normalizeGhostRedirects,
} from '~/build/redirects.ts';
import { resetWarningCount } from '~/util/logger.ts';

async function makeTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeGhostRedirects(cwd: string, filename: string, body: string): Promise<void> {
  await mkdir(join(cwd, 'content', 'data'), { recursive: true });
  await writeFile(join(cwd, 'content', 'data', filename), body);
}

beforeEach(() => {
  resetWarningCount();
});

afterEach(() => {
  resetWarningCount();
});

describe('loadGhostStyleRedirects', () => {
  test('returns [] when content/data/redirects.* does not exist', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-missing-');
    expect(await loadGhostStyleRedirects(cwd)).toEqual([]);
  });

  test('parses Ghost status-keyed YAML', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-yaml-');
    await writeGhostRedirects(
      cwd,
      'redirects.yaml',
      [
        '301:',
        '  - from: /old-permanent',
        '    to: /new-permanent',
        '302:',
        '  - from: /old-temp',
        '    to: /new-temp',
      ].join('\n'),
    );
    expect(await loadGhostStyleRedirects(cwd)).toEqual([
      { from: '/old-permanent', to: '/new-permanent', status: 301, force: false },
      { from: '/old-temp', to: '/new-temp', status: 302, force: false },
    ]);
  });

  test('parses Ghost flat-array JSON with `permanent` flag', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-json-');
    await writeGhostRedirects(
      cwd,
      'redirects.json',
      JSON.stringify([
        { from: '/a', to: '/A', permanent: true },
        { from: '/b', to: '/B', permanent: false },
      ]),
    );
    expect(await loadGhostStyleRedirects(cwd)).toEqual([
      { from: '/a', to: '/A', status: 301, force: false },
      { from: '/b', to: '/B', status: 302, force: false },
    ]);
  });

  test('defaults to status 302 when neither permanent nor status is set', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-default-');
    await writeGhostRedirects(cwd, 'redirects.json', JSON.stringify([{ from: '/x', to: '/y' }]));
    expect(await loadGhostStyleRedirects(cwd)).toEqual([
      { from: '/x', to: '/y', status: 302, force: false },
    ]);
  });

  test('skips invalid entries (missing from/to) with a warn', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-invalid-');
    await writeGhostRedirects(
      cwd,
      'redirects.json',
      JSON.stringify([
        { to: '/no-from' },
        { from: '/no-to' },
        { from: '', to: '/empty-from' },
        { from: '/ok', to: '/dest' },
      ]),
    );
    expect(await loadGhostStyleRedirects(cwd)).toEqual([
      { from: '/ok', to: '/dest', status: 302, force: false },
    ]);
  });

  test('skips unknown status keys in nested form', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-bad-status-key-');
    await writeGhostRedirects(
      cwd,
      'redirects.yaml',
      [
        '418:',
        '  - from: /teapot',
        '    to: /coffee',
        '301:',
        '  - from: /ok',
        '    to: /dest',
      ].join('\n'),
    );
    expect(await loadGhostStyleRedirects(cwd)).toEqual([
      { from: '/ok', to: '/dest', status: 301, force: false },
    ]);
  });

  test('throws on malformed YAML', async () => {
    const cwd = await makeTmp('laurel-ghost-redirects-malformed-');
    await writeGhostRedirects(cwd, 'redirects.yaml', '301:\n  - from: /x\n    to: [bad');
    await expect(loadGhostStyleRedirects(cwd)).rejects.toThrow(/Failed to parse/);
  });
});

describe('normalizeGhostRedirects', () => {
  test('honors per-entry status overriding parent key', () => {
    expect(
      normalizeGhostRedirects({
        '301': [{ from: '/a', to: '/A', status: 308 }],
      }),
    ).toEqual([{ from: '/a', to: '/A', status: 308, force: false }]);
  });

  test('honors per-entry status in flat array', () => {
    expect(
      normalizeGhostRedirects([
        { from: '/a', to: '/A', status: 307 },
        { from: '/b', to: '/B', permanent: true },
      ]),
    ).toEqual([
      { from: '/a', to: '/A', status: 307, force: false },
      { from: '/b', to: '/B', status: 301, force: false },
    ]);
  });
});

describe('loadAllRedirects', () => {
  test('merges project-root redirects.yaml with content/data/redirects.yaml', async () => {
    const cwd = await makeTmp('laurel-all-redirects-merge-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /root', '  to: /R', '  status: 308'].join('\n'),
    );
    await writeGhostRedirects(
      cwd,
      'redirects.yaml',
      ['301:', '  - from: /ghost', '    to: /G'].join('\n'),
    );
    expect(await loadAllRedirects(cwd)).toEqual([
      { from: '/root', to: '/R', status: 308, force: false },
      { from: '/ghost', to: '/G', status: 301, force: false },
    ]);
  });

  test('returns [] when neither file exists', async () => {
    const cwd = await makeTmp('laurel-all-redirects-empty-');
    expect(await loadAllRedirects(cwd)).toEqual([]);
  });
});

describe('formatRedirectsFile', () => {
  test('emits Netlify / Cloudflare Pages format', () => {
    const body = formatRedirectsFile([
      { from: '/old', to: '/new', status: 301, force: false },
      { from: '/temp', to: '/here', status: 302, force: false },
    ]);
    expect(body).toBe(
      [
        '# Custom redirects (from content/data/redirects.yaml or redirects.yaml)',
        '/old  /new  301',
        '/temp  /here  302',
        '',
      ].join('\n'),
    );
  });
});

describe('emitRedirectsComponent', () => {
  test('writes dist/_redirects when enabled and rules exist', async () => {
    const out = await makeTmp('laurel-emit-redirects-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/a', to: '/b', status: 301, force: false }],
      enabled: true,
      emitHtml: false,
    });
    const body = await readFile(join(out, '_redirects'), 'utf8');
    expect(body).toContain('/a  /b  301');
  });

  test('does NOT write _redirects when enabled but rule list is empty', async () => {
    const out = await makeTmp('laurel-emit-redirects-empty-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [],
      enabled: true,
      emitHtml: false,
    });
    await expect(readFile(join(out, '_redirects'), 'utf8')).rejects.toThrow();
  });

  test('does NOT write _redirects when disabled', async () => {
    const out = await makeTmp('laurel-emit-redirects-disabled-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/a', to: '/b', status: 301, force: false }],
      enabled: false,
      emitHtml: false,
    });
    await expect(readFile(join(out, '_redirects'), 'utf8')).rejects.toThrow();
  });

  test('does NOT emit per-rule HTML by default', async () => {
    const out = await makeTmp('laurel-emit-redirects-no-html-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      enabled: true,
      emitHtml: false,
    });
    await expect(readFile(join(out, 'old', 'index.html'), 'utf8')).rejects.toThrow();
  });

  test('emits per-rule meta-refresh HTML when emit_html is true', async () => {
    const out = await makeTmp('laurel-emit-redirects-html-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/old', to: '/new', status: 301, force: false }],
      enabled: true,
      emitHtml: true,
    });
    const html = await readFile(join(out, 'old', 'index.html'), 'utf8');
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/new">');
    expect(html).toContain('<link rel="canonical" href="/new">');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test('collapses duplicate `from` (first-match)', async () => {
    const out = await makeTmp('laurel-emit-redirects-collapse-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [
        { from: '/dup', to: '/first', status: 301, force: false },
        { from: '/dup', to: '/second', status: 302, force: false },
      ],
      enabled: true,
      emitHtml: false,
    });
    const body = await readFile(join(out, '_redirects'), 'utf8');
    expect(body).toContain('/dup  /first  301');
    expect(body).not.toContain('/second');
  });

  test('skips HTML emit for traversal-y `from` values', async () => {
    const out = await makeTmp('laurel-emit-redirects-traversal-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/../etc/passwd', to: '/safe', status: 301, force: false }],
      enabled: true,
      emitHtml: true,
    });
    // The `_redirects` file still contains the rule (host-level decision), but
    // no HTML file lands at a traversal path.
    const body = await readFile(join(out, '_redirects'), 'utf8');
    expect(body).toContain('/../etc/passwd');
    await expect(
      readFile(join(out, '..', 'etc', 'passwd', 'index.html'), 'utf8'),
    ).rejects.toThrow();
  });

  test('escapes HTML-special characters in the destination URL', async () => {
    const out = await makeTmp('laurel-emit-redirects-escape-');
    await emitRedirectsComponent({
      outputDir: out,
      rules: [{ from: '/x', to: '/dest?q=<script>', status: 301, force: false }],
      enabled: true,
      emitHtml: true,
    });
    const html = await readFile(join(out, 'x', 'index.html'), 'utf8');
    expect(html).toContain('content="0; url=/dest?q=&lt;script&gt;"');
    expect(html).not.toContain('<script>/dest?q=');
  });
});
