import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitRobots } from '~/build/robots.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-robots-'));
}

async function makeCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-robots-cwd-'));
}

describe('emitRobots', () => {
  test('writes default Allow body with absolute sitemap URL', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const config = configSchema.parse({
      site: { title: 'Robots Test', url: 'https://robots.test' },
    });

    await emitRobots({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(
      ['User-agent: *', 'Allow: /', 'Sitemap: https://robots.test/sitemap.xml', ''].join('\n'),
    );
  });

  test('strips trailing slash from site.url before composing sitemap URL', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const config = configSchema.parse({
      site: { title: 'Robots Test', url: 'https://robots.test/' },
    });

    await emitRobots({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toContain('Sitemap: https://robots.test/sitemap.xml');
    expect(body).not.toContain('robots.test//sitemap.xml');
  });

  test('emits Disallow: / and omits Sitemap when components.robots.disallow is true', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const config = configSchema.parse({
      site: { title: 'Staging', url: 'https://staging.test' },
      components: { robots: { disallow: true } },
    });

    await emitRobots({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(['User-agent: *', 'Disallow: /', ''].join('\n'));
    expect(body).not.toContain('Sitemap:');
  });

  test('copies static/robots.txt verbatim when the override file exists', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    const override = [
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: *',
      'Allow: /',
      'Sitemap: https://robots.test/sitemap.xml',
      'Sitemap: https://robots.test/news-sitemap.xml',
      '',
    ].join('\n');
    await writeFile(join(cwd, 'static', 'robots.txt'), override, 'utf8');
    const config = configSchema.parse({
      site: { title: 'Robots Test', url: 'https://robots.test' },
    });

    await emitRobots({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(override);
  });

  test('override wins over the disallow shortcut so the file on disk is the single source of truth', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    const override = ['User-agent: *', 'Allow: /', ''].join('\n');
    await writeFile(join(cwd, 'static', 'robots.txt'), override, 'utf8');
    const config = configSchema.parse({
      site: { title: 'Staging', url: 'https://staging.test' },
      components: { robots: { disallow: true } },
    });

    await emitRobots({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'robots.txt'), 'utf8');
    expect(body).toBe(override);
    expect(body).not.toContain('Disallow: /');
  });
});
