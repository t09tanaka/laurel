import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitNetlifyHeaders } from '~/build/netlify.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-netlify-'));
}

describe('emitNetlifyHeaders', () => {
  test('does not emit _headers when disabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: false });

    expect(existsSync(join(outputDir, '_headers'))).toBe(false);
  });

  test('emits _headers at the output root when enabled', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });

  test('pins fingerprinted theme assets to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });

  test('pins content image paths to a year of immutable caching', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain(
      '/content/images/*\n  Cache-Control: public, max-age=31536000, immutable',
    );
  });

  test('forces the catch-all rule to revalidate so HTML never goes stale', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toMatch(
      /\/\*\n(?:\x20{2}[^\n]+\n)*\x20{2}Cache-Control: public, max-age=0, must-revalidate/,
    );
  });

  test('sets baseline security headers on the catch-all rule', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('X-Content-Type-Options: nosniff');
    expect(body).toContain('Referrer-Policy: strict-origin-when-cross-origin');
  });

  test('places the catch-all rule after the more specific rules so asset overrides win', async () => {
    const outputDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir, enabled: true });

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    const assetsIdx = body.indexOf('/assets/*');
    const catchAllIdx = body.indexOf('\n/*\n');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitNetlifyHeaders({ outputDir, enabled: true });

    expect(existsSync(join(outputDir, '_headers'))).toBe(true);
  });

  test('produces the same _headers content as Cloudflare Pages so deploy targets share defaults', async () => {
    const { emitCloudflarePagesHeaders } = await import('~/build/cloudflare-pages.ts');
    const netlifyDir = await makeOutputDir();
    const cfDir = await makeOutputDir();

    await emitNetlifyHeaders({ outputDir: netlifyDir, enabled: true });
    await emitCloudflarePagesHeaders({ outputDir: cfDir, enabled: true });

    const netlifyBody = await readFile(join(netlifyDir, '_headers'), 'utf8');
    const cfBody = await readFile(join(cfDir, '_headers'), 'utf8');
    expect(netlifyBody).toBe(cfBody);
  });
});
