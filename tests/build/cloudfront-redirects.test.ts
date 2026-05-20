import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatCloudFrontRedirectFunction,
  formatCloudFrontRedirectMap,
  generateCloudFrontRedirectFunction,
} from '~/build/cloudfront-redirects.ts';

describe('formatCloudFrontRedirectMap', () => {
  test('collapses duplicate sources and serializes status plus location', () => {
    const body = formatCloudFrontRedirectMap([
      { from: '/old', to: '/new/', status: 301, force: false },
      { from: '/temp', to: 'https://example.com/landing', status: 302, force: false },
      { from: '/old', to: '/ignored', status: 308, force: false },
    ]);

    expect(JSON.parse(body)).toEqual({
      '/old': { statusCode: 301, location: '/new/' },
      '/temp': { statusCode: 302, location: 'https://example.com/landing' },
    });
  });
});

describe('formatCloudFrontRedirectFunction', () => {
  test('inlines redirects into the CloudFront Function sample', () => {
    const body = formatCloudFrontRedirectFunction([
      { from: '/feed', to: '/rss.xml', status: 301, force: false },
      { from: '/preview', to: '/new-preview', status: 307, force: false },
    ]);

    expect(body).toContain('CloudFront Function');
    expect(body).toContain('"\\/feed"');
    expect(body).toContain('"location": "\\/rss.xml"');
    expect(body).toContain('"statusCode": 307');
    expect(body).toContain('function handler(event)');
    expect(body).not.toContain('__NECTAR_REDIRECTS_JSON__');
  });
});

describe('generateCloudFrontRedirectFunction', () => {
  test('reads redirects.yaml and writes a CloudFront Function with inlined rules', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-cloudfront-redirects-'));
    const outputPath = join(cwd, 'generated', 'cloudfront-redirects.generated.js');
    await writeFile(
      join(cwd, 'redirects.yaml'),
      ['- from: /old', '  to: /new', '  status: 308'].join('\n'),
    );

    await generateCloudFrontRedirectFunction({ cwd, outputPath });

    const body = await readFile(outputPath, 'utf8');
    expect(body).toContain('"\\/old"');
    expect(body).toContain('"location": "\\/new"');
    expect(body).toContain('"statusCode": 308');
  });
});
