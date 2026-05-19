import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitRobots } from '~/build/robots.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-robots-'));
}

describe('emitRobots', () => {
  test('writes default Allow body with absolute sitemap URL', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'Robots Test', url: 'https://robots.test' },
    });

    await emitRobots({ config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(
      ['User-agent: *', 'Allow: /', 'Sitemap: https://robots.test/sitemap.xml', ''].join('\n'),
    );
  });

  test('strips trailing slash from site.url before composing sitemap URL', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'Robots Test', url: 'https://robots.test/' },
    });

    await emitRobots({ config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('Sitemap: https://robots.test/sitemap.xml');
    expect(body).not.toContain('robots.test//sitemap.xml');
  });

  test('emits Disallow: / and omits Sitemap when components.robots.disallow is true', async () => {
    const outputDir = await makeOutputDir();
    const config = configSchema.parse({
      site: { title: 'Staging', url: 'https://staging.test' },
      components: { robots: { disallow: true } },
    });

    await emitRobots({ config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(['User-agent: *', 'Disallow: /', ''].join('\n'));
    expect(body).not.toContain('Sitemap:');
  });
});
