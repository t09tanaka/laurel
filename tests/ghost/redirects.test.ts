import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGhostExport } from '~/ghost/import.ts';
import {
  emitNetlifyRedirects,
  emitNginxRedirects,
  emitVercelRedirects,
  loadRedirectsJson,
  normalizeRedirects,
  simplifyFromPattern,
  slugChangesToRules,
} from '~/ghost/redirects.ts';
import { ensureDir } from '~/util/fs.ts';

describe('redirects — normalizeRedirects', () => {
  test('accepts the flat array form Ghost emits today', () => {
    const out = normalizeRedirects([
      { from: '/old', to: '/new', permanent: true },
      { from: '/old2', to: '/new2', permanent: false },
    ]);
    expect(out).toEqual([
      { from: '/old', to: '/new', permanent: true },
      { from: '/old2', to: '/new2', permanent: false },
    ]);
  });

  test('accepts the grouped {301,302} form older Ghost admin tooling wrote', () => {
    const out = normalizeRedirects({
      '301': [{ from: '/a', to: '/b' }],
      '302': [{ from: '/c', to: '/d' }],
    });
    expect(out).toEqual([
      { from: '/a', to: '/b', permanent: true },
      { from: '/c', to: '/d', permanent: false },
    ]);
  });

  test('defaults missing permanent to true (Ghost admin defaults to 301)', () => {
    const out = normalizeRedirects([{ from: '/x', to: '/y' }]);
    expect(out).toEqual([{ from: '/x', to: '/y', permanent: true }]);
  });

  test('skips entries without a string from/to so junk does not become a redirect', () => {
    const out = normalizeRedirects([
      { from: '/ok', to: '/yes' },
      { from: 123, to: '/yes' },
      { to: '/yes' },
      null,
      'string',
    ]);
    expect(out).toEqual([{ from: '/ok', to: '/yes', permanent: true }]);
  });
});

describe('redirects — simplifyFromPattern', () => {
  test('strips ^...$ anchors so the path is usable on Netlify/Vercel', () => {
    expect(simplifyFromPattern('^/foo$')).toBe('/foo');
  });

  test('un-escapes regex-escaped slashes', () => {
    expect(simplifyFromPattern('^\\/foo\\/bar\\/$')).toBe('/foo/bar/');
  });

  test('prepends a leading slash when the pattern lacks one after stripping', () => {
    expect(simplifyFromPattern('^foo$')).toBe('/foo');
  });
});

describe('redirects — emitters', () => {
  test('Netlify emitter writes path-source-status lines and skips regex patterns with a warning', () => {
    const out = emitNetlifyRedirects([
      { from: '^/old$', to: '/new', permanent: true },
      { from: '^/maybe(/.*)?$', to: '/catchall', permanent: false },
    ]);
    expect(out).toContain('/old  /new  301');
    expect(out).toContain('# WARN: regex pattern');
    expect(out).not.toContain('/maybe(/.*)?  /catchall');
  });

  test('Vercel emitter produces a redirects array with permanent flag preserved', () => {
    const out = emitVercelRedirects([{ from: '^/old$', to: '/new', permanent: false }]);
    const parsed = JSON.parse(out);
    expect(parsed.redirects).toEqual([{ source: '/old', destination: '/new', permanent: false }]);
  });

  test('Vercel emitter notes regex patterns it had to skip via _comment', () => {
    const out = emitVercelRedirects([
      { from: '^/(a|b)$', to: '/c', permanent: true },
      { from: '^/d$', to: '/e', permanent: true },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.redirects).toEqual([{ source: '/d', destination: '/e', permanent: true }]);
    expect(parsed._comment).toContain('Skipped 1');
  });

  test('nginx emitter forwards Ghost regex as-is and picks permanent/redirect by flag', () => {
    const out = emitNginxRedirects([
      { from: '^/old$', to: '/new', permanent: true },
      { from: '^/temp$', to: '/here', permanent: false },
    ]);
    expect(out).toContain('rewrite ^/old$ /new permanent;');
    expect(out).toContain('rewrite ^/temp$ /here redirect;');
  });
});

describe('redirects — slugChangesToRules', () => {
  test('maps post slug changes to permanent / redirects', () => {
    expect(
      slugChangesToRules([
        { kind: 'post', oldSlug: 'My-Post', newSlug: 'my-post' },
        { kind: 'page', oldSlug: 'About-Us', newSlug: 'about-us' },
      ]),
    ).toEqual([
      { from: '/My-Post/', to: '/my-post/', permanent: true },
      { from: '/About-Us/', to: '/about-us/', permanent: true },
    ]);
  });

  test('namespaces tag and author redirects under /tag/ and /author/', () => {
    expect(
      slugChangesToRules([
        { kind: 'tag', oldSlug: 'News', newSlug: 'news' },
        { kind: 'author', oldSlug: 'Jane-Doe', newSlug: 'jane-doe' },
      ]),
    ).toEqual([
      { from: '/tag/News/', to: '/tag/news/', permanent: true },
      { from: '/author/Jane-Doe/', to: '/author/jane-doe/', permanent: true },
    ]);
  });

  test('drops identity rewrites so a no-op slug change does not create a self-redirect', () => {
    expect(slugChangesToRules([{ kind: 'post', oldSlug: 'same', newSlug: 'same' }])).toEqual([]);
  });
});

describe('redirects — loadRedirectsJson', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'laurel-redirects-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('returns [] when the file is missing (most exports have no custom redirects)', async () => {
    expect(await loadRedirectsJson(dir)).toEqual([]);
  });

  test('returns [] and warns when the file is malformed JSON', async () => {
    await ensureDir(join(dir, 'data'));
    await writeFile(join(dir, 'data', 'redirects.json'), 'not json', 'utf8');
    expect(await loadRedirectsJson(dir)).toEqual([]);
  });

  test('parses a valid redirects.json with the array form', async () => {
    await ensureDir(join(dir, 'data'));
    await writeFile(
      join(dir, 'data', 'redirects.json'),
      JSON.stringify([{ from: '/old', to: '/new', permanent: true }]),
      'utf8',
    );
    expect(await loadRedirectsJson(dir)).toEqual([{ from: '/old', to: '/new', permanent: true }]);
  });
});

describe('importGhostExport — redirects integration (#503)', () => {
  let cwd: string;
  let exportDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'laurel-import-redirects-'));
    exportDir = join(cwd, 'export');
    await ensureDir(exportDir);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('emits _redirects, vercel.json, nginx.conf from content/data/redirects.json', async () => {
    const exportJson = join(exportDir, 'ghost.json');
    await writeFile(
      exportJson,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>Hello</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
      'utf8',
    );
    await ensureDir(join(exportDir, 'content', 'data'));
    await writeFile(
      join(exportDir, 'content', 'data', 'redirects.json'),
      JSON.stringify([
        { from: '/old-post', to: '/hello', permanent: true },
        { from: '/temp', to: '/elsewhere', permanent: false },
      ]),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportDir });

    expect(summary.redirectsImported).toBe(2);
    expect(summary.slugRedirects).toBe(0);
    const netlify = await readFile(join(cwd, 'migration/redirects/_redirects'), 'utf8');
    expect(netlify).toContain('/old-post  /hello  301');
    expect(netlify).toContain('/temp  /elsewhere  302');
    const vercel = JSON.parse(await readFile(join(cwd, 'migration/redirects/vercel.json'), 'utf8'));
    expect(vercel.redirects).toEqual([
      { source: '/old-post', destination: '/hello', permanent: true },
      { source: '/temp', destination: '/elsewhere', permanent: false },
    ]);
    const nginx = await readFile(join(cwd, 'migration/redirects/nginx.conf'), 'utf8');
    expect(nginx).toContain('rewrite /old-post /hello permanent;');
    expect(nginx).toContain('rewrite /temp /elsewhere redirect;');
  });

  test('synthesizes slug-change redirects when safeSlug rewrites a Ghost slug', async () => {
    const exportJson = join(exportDir, 'ghost.json');
    await writeFile(
      exportJson,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Cafe',
                  slug: 'Café',
                  html: '<p>Cafe</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
              tags: [
                {
                  id: 't1',
                  slug: 'News-Items',
                  name: 'News Items',
                  description: 'Tag with rewritten slug',
                },
              ],
            },
          },
        ],
      }),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportJson });

    expect(summary.slugRedirects).toBe(2);
    expect(summary.redirectsImported).toBe(0);
    const netlify = await readFile(join(cwd, 'migration/redirects/_redirects'), 'utf8');
    expect(netlify).toContain('/Café/  /cafe/  301');
    expect(netlify).toContain('/tag/News-Items/  /tag/news-items/  301');
  });

  test('skips writing any redirect file when there are no redirects to emit', async () => {
    const exportJson = join(exportDir, 'ghost.json');
    await writeFile(
      exportJson,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>Hello</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportJson });

    expect(summary.redirectsImported).toBe(0);
    expect(summary.slugRedirects).toBe(0);
    await expect(readFile(join(cwd, 'migration/redirects/_redirects'), 'utf8')).rejects.toThrow();
  });

  test('dry-run reports counts without writing the migration/ folder', async () => {
    const exportJson = join(exportDir, 'ghost.json');
    await writeFile(
      exportJson,
      JSON.stringify({
        db: [
          {
            data: {
              posts: [
                {
                  id: 'p1',
                  title: 'Hello',
                  slug: 'hello',
                  html: '<p>Hello</p>',
                  status: 'published',
                  type: 'post',
                },
              ],
            },
          },
        ],
      }),
      'utf8',
    );
    await ensureDir(join(exportDir, 'content', 'data'));
    await writeFile(
      join(exportDir, 'content', 'data', 'redirects.json'),
      JSON.stringify([{ from: '/old', to: '/new', permanent: true }]),
      'utf8',
    );

    const summary = await importGhostExport({ cwd, file: exportDir, dryRun: true });

    expect(summary.redirectsImported).toBe(1);
    expect(summary.dryRun).toBe(true);
    await expect(readFile(join(cwd, 'migration/redirects/_redirects'), 'utf8')).rejects.toThrow();
  });
});
