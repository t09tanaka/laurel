import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyRoutesYaml,
  loadRoutesYaml,
  resolveRouteEntries,
  routeUrlToOutputPath,
} from '~/build/routes-yaml.ts';

async function makeTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('loadRoutesYaml', () => {
  test('returns an empty config when neither routes.yaml nor routes.yml exists', async () => {
    const cwd = await makeTmp('nectar-ry-missing-');
    expect(await loadRoutesYaml(cwd)).toEqual(emptyRoutesYaml());
  });

  test('parses routes / collections / taxonomies sections', async () => {
    const cwd = await makeTmp('nectar-ry-full-');
    await writeFile(
      join(cwd, 'routes.yaml'),
      [
        'routes:',
        '  /featured/: featured',
        '  /about/:',
        '    template: about',
        '    content_type: html',
        '',
        'collections:',
        '  /:',
        '    permalink: /{slug}/',
        '    template: index',
        '    filter: featured:false',
        '',
        'taxonomies:',
        '  tag: /categories/{slug}/',
        '  author: /people/{slug}/',
        '',
      ].join('\n'),
    );
    const yaml = await loadRoutesYaml(cwd);
    expect(yaml.routes['/featured/']).toBe('featured');
    expect(yaml.routes['/about/']).toEqual({
      template: 'about',
      content_type: 'html',
    });
    expect(yaml.collections['/']).toEqual({
      permalink: '/{slug}/',
      template: 'index',
      filter: 'featured:false',
    });
    expect(yaml.taxonomies).toEqual({
      tag: '/categories/{slug}/',
      author: '/people/{slug}/',
    });
  });

  test('accepts routes.yml as a fallback extension', async () => {
    const cwd = await makeTmp('nectar-ry-yml-');
    await writeFile(join(cwd, 'routes.yml'), 'routes:\n  /featured/: featured\n');
    const yaml = await loadRoutesYaml(cwd);
    expect(yaml.routes['/featured/']).toBe('featured');
  });

  test('prefers routes.yaml over routes.yml when both exist', async () => {
    const cwd = await makeTmp('nectar-ry-both-');
    await writeFile(join(cwd, 'routes.yaml'), 'routes:\n  /a/: from-yaml\n');
    await writeFile(join(cwd, 'routes.yml'), 'routes:\n  /a/: from-yml\n');
    const yaml = await loadRoutesYaml(cwd);
    expect(yaml.routes['/a/']).toBe('from-yaml');
  });

  test('treats an empty or comment-only file as an empty config', async () => {
    const cwd = await makeTmp('nectar-ry-empty-');
    await writeFile(join(cwd, 'routes.yaml'), '# nothing yet\n');
    expect(await loadRoutesYaml(cwd)).toEqual(emptyRoutesYaml());
  });

  test('wraps malformed YAML errors with the filename', async () => {
    const cwd = await makeTmp('nectar-ry-bad-yaml-');
    await writeFile(join(cwd, 'routes.yaml'), 'routes:\n  /x/: : :\n');
    await expect(loadRoutesYaml(cwd)).rejects.toThrow(/routes\.yaml/);
  });

  test('rejects unknown top-level keys', async () => {
    const cwd = await makeTmp('nectar-ry-unknown-key-');
    await writeFile(join(cwd, 'routes.yaml'), 'whatever:\n  foo: bar\n');
    await expect(loadRoutesYaml(cwd)).rejects.toThrow(/Invalid routes\.yaml/);
  });

  test('rejects route entries missing a template field', async () => {
    const cwd = await makeTmp('nectar-ry-no-tpl-');
    await writeFile(join(cwd, 'routes.yaml'), 'routes:\n  /x/:\n    content_type: html\n');
    await expect(loadRoutesYaml(cwd)).rejects.toThrow(/Invalid routes\.yaml/);
  });

  test('rejects taxonomy permalinks that do not start with /', async () => {
    const cwd = await makeTmp('nectar-ry-tax-bad-');
    await writeFile(join(cwd, 'routes.yaml'), 'taxonomies:\n  tag: tag/{slug}/\n');
    await expect(loadRoutesYaml(cwd)).rejects.toThrow(/Invalid routes\.yaml/);
  });

  test('rejects unsupported content_type values', async () => {
    const cwd = await makeTmp('nectar-ry-bad-ct-');
    await writeFile(
      join(cwd, 'routes.yaml'),
      'routes:\n  /x/:\n    template: x\n    content_type: pdf\n',
    );
    await expect(loadRoutesYaml(cwd)).rejects.toThrow(/Invalid routes\.yaml/);
  });
});

describe('resolveRouteEntries', () => {
  test('normalizes string-form entries to template + default html content_type', () => {
    const yaml = emptyRoutesYaml();
    yaml.routes['/featured/'] = 'featured';
    const resolved = resolveRouteEntries(yaml);
    expect(resolved).toEqual([{ url: '/featured/', template: 'featured', content_type: 'html' }]);
  });

  test('passes object-form fields through with content_type defaulting to html', () => {
    const yaml = emptyRoutesYaml();
    yaml.routes['/about/'] = { template: 'about' };
    yaml.routes['/data/'] = { template: 'tag', data: 'tag.info', content_type: 'json' };
    const byUrl = Object.fromEntries(resolveRouteEntries(yaml).map((r) => [r.url, r]));
    expect(byUrl['/about/']).toEqual({
      url: '/about/',
      template: 'about',
      content_type: 'html',
    });
    expect(byUrl['/data/']).toEqual({
      url: '/data/',
      template: 'tag',
      content_type: 'json',
      data: 'tag.info',
    });
  });
});

describe('routeUrlToOutputPath', () => {
  test('maps `/` to index.html', () => {
    expect(routeUrlToOutputPath('/')).toBe('index.html');
  });

  test('maps trailing-slash URLs to a directory index', () => {
    expect(routeUrlToOutputPath('/featured/')).toBe('featured/index.html');
    expect(routeUrlToOutputPath('/a/b/')).toBe('a/b/index.html');
  });

  test('writes literal filenames verbatim when the last segment has an extension', () => {
    expect(routeUrlToOutputPath('/sitemap.xml')).toBe('sitemap.xml');
    expect(routeUrlToOutputPath('/feed/posts.rss')).toBe('feed/posts.rss');
  });

  test('produces an index.html under a trailing-slash-less directory path', () => {
    expect(routeUrlToOutputPath('/featured')).toBe('featured/index.html');
  });

  test('throws when the URL does not start with /', () => {
    expect(() => routeUrlToOutputPath('featured/')).toThrow();
  });
});
