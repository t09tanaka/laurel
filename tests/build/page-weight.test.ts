import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PAGE_WEIGHT_BUDGETS,
  formatPageWeightFailures,
  summarizePageWeight,
} from '~/build/page-weight.ts';

function makeDist(): string {
  return mkdtempSync(join(tmpdir(), 'nectar-page-weight-'));
}

function writeAsset(distRoot: string, path: string, bytes: number): void {
  const file = join(distRoot, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x'.repeat(bytes), 'utf8');
}

describe('page weight gate helpers', () => {
  test('summarizes local assets by type and deduplicates repeated references', async () => {
    const distRoot = makeDist();
    writeAsset(distRoot, 'index.html', '<!doctype html>'.length);
    writeAsset(distRoot, 'assets/app.css', 1200);
    writeAsset(distRoot, 'assets/app.js', 900);
    writeAsset(distRoot, 'content/images/hero.jpg', 4000);
    writeAsset(distRoot, 'content/images/size/w600/hero.jpg', 2000);

    const html = [
      '<!doctype html>',
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script src="/assets/app.js"></script>',
      '<img src="/content/images/hero.jpg" srcset="/content/images/size/w600/hero.jpg 600w, /content/images/hero.jpg 1200w">',
      '<meta property="og:image" content="/content/images/hero.jpg">',
    ].join('');
    writeFileSync(join(distRoot, 'index.html'), html, 'utf8');

    const summary = await summarizePageWeight({ distRoot, htmlFile: join(distRoot, 'index.html') });

    expect(summary.route).toBe('/');
    expect(summary.assetBytes.css).toBe(1200);
    expect(summary.assetBytes.js).toBe(900);
    expect(summary.assetBytes.image).toBe(6000);
    expect(summary.maxImageBytes).toBe(4000);
    expect(summary.localAssets.map((asset) => asset.path)).toEqual([
      '/assets/app.css',
      '/assets/app.js',
      '/content/images/hero.jpg',
      '/content/images/size/w600/hero.jpg',
    ]);
  });

  test('reports budget failures and render-blocking external assets', async () => {
    const distRoot = makeDist();
    writeAsset(distRoot, 'assets/app.js', DEFAULT_PAGE_WEIGHT_BUDGETS.jsBytes + 1);
    writeAsset(distRoot, 'content/images/hero.jpg', DEFAULT_PAGE_WEIGHT_BUDGETS.maxImageBytes + 1);
    const html = [
      '<!doctype html>',
      '<script src="/assets/app.js"></script>',
      '<script src="https://cdn.example.com/heavy.js"></script>',
      '<link rel="stylesheet" href="https://cdn.example.com/heavy.css">',
      '<img src="/content/images/hero.jpg">',
    ].join('');
    mkdirSync(join(distRoot, 'post'), { recursive: true });
    writeFileSync(join(distRoot, 'post/index.html'), html, 'utf8');

    const summary = await summarizePageWeight({
      distRoot,
      htmlFile: join(distRoot, 'post/index.html'),
    });
    const failures = formatPageWeightFailures([summary], DEFAULT_PAGE_WEIGHT_BUDGETS);

    expect(failures).toContain('/post/');
    expect(failures).toContain('js');
    expect(failures).toContain('max image');
    expect(failures).toContain('external script');
    expect(failures).toContain('external stylesheet');
  });

  test('ignores data URI srcset entries without treating their commas as assets', async () => {
    const distRoot = makeDist();
    const html = [
      '<!doctype html>',
      '<img srcset="data:image/png;base64,AAAA 1x, data:image/png;base64,BBBB 2x">',
    ].join('');
    writeFileSync(join(distRoot, 'index.html'), html, 'utf8');

    const summary = await summarizePageWeight({ distRoot, htmlFile: join(distRoot, 'index.html') });

    expect(summary.localAssets).toEqual([]);
    expect(summary.missingAssets).toEqual([]);
  });
});
