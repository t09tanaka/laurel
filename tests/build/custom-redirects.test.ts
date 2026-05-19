import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collapseRedirectRules,
  emitCustomRedirects,
  formatRedirectsBody,
  loadCustomRedirects,
} from '~/build/custom-redirects.ts';

async function makeTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function makeCwdAndOutput(): Promise<{ cwd: string; outputDir: string }> {
  const cwd = await makeTmp('nectar-custom-redirects-cwd-');
  const outputDir = await makeTmp('nectar-custom-redirects-out-');
  return { cwd, outputDir };
}

describe('loadCustomRedirects', () => {
  test('returns [] when neither redirects.yaml nor redirects.yml exists', async () => {
    const cwd = await makeTmp('nectar-cr-load-missing-');
    expect(await loadCustomRedirects(cwd)).toEqual([]);
  });

  test('parses redirects.yaml as a flat list of rules', async () => {
    const cwd = await makeTmp('nectar-cr-load-yaml-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /old', '  to: /new', '  status: 301'].join('\n'),
    );
    expect(await loadCustomRedirects(cwd)).toEqual([
      { from: '/old', to: '/new', status: 301, force: false },
    ]);
  });

  test('also accepts redirects.yml as a fallback extension', async () => {
    const cwd = await makeTmp('nectar-cr-load-yml-');
    await writeFile(join(cwd, 'redirects.yml'), ['- from: /a', '  to: /b'].join('\n'));
    expect(await loadCustomRedirects(cwd)).toEqual([
      { from: '/a', to: '/b', status: 301, force: false },
    ]);
  });

  test('defaults missing status to 301', async () => {
    const cwd = await makeTmp('nectar-cr-load-default-');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /x\n  to: /y\n');
    const rules = await loadCustomRedirects(cwd);
    expect(rules[0]?.status).toBe(301);
  });

  test('accepts 302, 307, and 308 status codes verbatim', async () => {
    const cwd = await makeTmp('nectar-cr-load-status-');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      [
        '- from: /a',
        '  to: /A',
        '  status: 302',
        '- from: /b',
        '  to: /B',
        '  status: 307',
        '- from: /c',
        '  to: /C',
        '  status: 308',
      ].join('\n'),
    );
    const rules = await loadCustomRedirects(cwd);
    expect(rules.map((r) => r.status)).toEqual([302, 307, 308]);
  });

  test('rejects unsupported status codes', async () => {
    const cwd = await makeTmp('nectar-cr-load-bad-status-');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /x\n  to: /y\n  status: 200\n');
    await expect(loadCustomRedirects(cwd)).rejects.toThrow(/Invalid redirects\.yaml/);
  });

  test('rejects rules missing from or to', async () => {
    const cwd = await makeTmp('nectar-cr-load-missing-fields-');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /x\n');
    await expect(loadCustomRedirects(cwd)).rejects.toThrow(/Invalid redirects\.yaml/);
  });

  test('treats an empty or comment-only file as no rules', async () => {
    const cwd = await makeTmp('nectar-cr-load-empty-');
    await writeFile(join(cwd, 'redirects.yaml'), '# nothing here yet\n');
    expect(await loadCustomRedirects(cwd)).toEqual([]);
  });

  test('wraps YAML parse errors with the filename', async () => {
    const cwd = await makeTmp('nectar-cr-load-bad-yaml-');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /x\n  to: : :\n');
    await expect(loadCustomRedirects(cwd)).rejects.toThrow(/redirects\.yaml/);
  });
});

describe('collapseRedirectRules', () => {
  test('drops later rules whose `from` repeats an earlier rule', () => {
    const out = collapseRedirectRules([
      { from: '/a', to: '/A', status: 301, force: false },
      { from: '/b', to: '/B', status: 301, force: false },
      { from: '/a', to: '/A2', status: 302, force: false },
    ]);
    expect(out).toEqual([
      { from: '/a', to: '/A', status: 301, force: false },
      { from: '/b', to: '/B', status: 301, force: false },
    ]);
  });

  test('keeps the original order of first-seen `from` values', () => {
    const out = collapseRedirectRules([
      { from: '/z', to: '/Z', status: 301, force: false },
      { from: '/a', to: '/A', status: 301, force: false },
    ]);
    expect(out.map((r) => r.from)).toEqual(['/z', '/a']);
  });
});

describe('formatRedirectsBody', () => {
  test('emits one space-separated rule per line with the status code', () => {
    const body = formatRedirectsBody([
      { from: '/old', to: '/new', status: 301, force: false },
      { from: '/feed', to: '/rss.xml', status: 302, force: false },
    ]);
    expect(body).toContain('/old  /new  301');
    expect(body).toContain('/feed  /rss.xml  302');
  });

  test('terminates the body with a trailing newline', () => {
    const body = formatRedirectsBody([{ from: '/a', to: '/b', status: 301, force: false }]);
    expect(body.endsWith('\n')).toBe(true);
  });
});

describe('emitCustomRedirects', () => {
  test('does not emit _redirects when cloudflare_pages is disabled', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /a\n  to: /b\n');

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: false,
    });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(false);
  });

  test('does not emit _redirects when redirects.yaml is missing', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(false);
  });

  test('writes a fresh _redirects when no prior file exists', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /old', '  to: /new', '  status: 301'].join('\n'),
    );

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/old  /new  301');
  });

  test('prepends custom rules before an existing _redirects from another emitter', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();
    await writeFile(
      join(outputDir, '_redirects'),
      '# api shadows\n/ghost/api/content/posts/  /ghost/api/content/posts/index.json  200\n',
    );
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /feed\n  to: /rss.xml\n');

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    const customIdx = body.indexOf('/feed  /rss.xml');
    const apiIdx = body.indexOf('/ghost/api/content/posts/');
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeGreaterThan(customIdx);
  });

  test('collapses duplicate `from` entries so only the first one is emitted', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();
    await writeFile(
      join(cwd, 'redirects.yaml'),
      [
        '- from: /dup',
        '  to: /first',
        '  status: 301',
        '- from: /dup',
        '  to: /second',
        '  status: 302',
      ].join('\n'),
    );

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/dup  /first  301');
    expect(body).not.toContain('/second');
  });

  test('honors all four supported status codes end-to-end', async () => {
    const { cwd, outputDir } = await makeCwdAndOutput();
    await writeFile(
      join(cwd, 'redirects.yaml'),
      [
        '- from: /p',
        '  to: /P',
        '  status: 301',
        '- from: /t',
        '  to: /T',
        '  status: 302',
        '- from: /r',
        '  to: /R',
        '  status: 307',
        '- from: /q',
        '  to: /Q',
        '  status: 308',
      ].join('\n'),
    );

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    const body = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(body).toContain('/p  /P  301');
    expect(body).toContain('/t  /T  302');
    expect(body).toContain('/r  /R  307');
    expect(body).toContain('/q  /Q  308');
  });

  test('creates the output directory when it does not yet exist', async () => {
    const cwd = await makeTmp('nectar-cr-emit-mkdir-cwd-');
    const outputRoot = await makeTmp('nectar-cr-emit-mkdir-out-');
    const outputDir = join(outputRoot, 'nested', 'dist');
    await writeFile(join(cwd, 'redirects.yaml'), '- from: /a\n  to: /b\n');

    await emitCustomRedirects({
      outputDir,
      rules: await loadCustomRedirects(cwd),
      enabled: true,
    });

    expect(existsSync(join(outputDir, '_redirects'))).toBe(true);
  });
});
