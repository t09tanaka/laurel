import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { precompressOutput } from '~/build/precompress.ts';

async function makeTempOutputDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'laurel-precompress-'));
}

// A 1 KiB string sits comfortably above the 256 B floor, well past the point
// where Brotli/gzip overhead exceeds savings, so the companion sizes are
// stable across runs and platforms.
const LARGE_HTML = `<!doctype html><html><body>${'<p>hello world</p>'.repeat(80)}</body></html>`;

describe('precompressOutput', () => {
  test('returns zero and emits nothing when off', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'index.html'), LARGE_HTML);
    const result = await precompressOutput({ outputDir: dir, format: 'off' });
    expect(result.fileCount).toBe(0);
    expect(existsSync(join(dir, 'index.html.br'))).toBe(false);
    expect(existsSync(join(dir, 'index.html.gz'))).toBe(false);
  });

  test('emits .br and .gz companions for HTML and CSS', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'index.html'), LARGE_HTML);
    await mkdir(join(dir, 'assets/built'), { recursive: true });
    const css = `body { background: white; }\n${'.x { color: red; }\n'.repeat(50)}`;
    await writeFile(join(dir, 'assets/built/screen.css'), css);

    const result = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(result.fileCount).toBe(2);

    expect(existsSync(join(dir, 'index.html.br'))).toBe(true);
    expect(existsSync(join(dir, 'index.html.gz'))).toBe(true);
    expect(existsSync(join(dir, 'assets/built/screen.css.br'))).toBe(true);
    expect(existsSync(join(dir, 'assets/built/screen.css.gz'))).toBe(true);

    const br = await readFile(join(dir, 'index.html.br'));
    expect(brotliDecompressSync(br).toString('utf8')).toBe(LARGE_HTML);
    const gz = await readFile(join(dir, 'index.html.gz'));
    expect(gunzipSync(gz).toString('utf8')).toBe(LARGE_HTML);
  });

  test('skips binary extensions (PNG, WOFF2, AVIF)', async () => {
    const dir = await makeTempOutputDir();
    const buf = Buffer.from('A'.repeat(2048));
    await writeFile(join(dir, 'logo.png'), buf);
    await writeFile(join(dir, 'font.woff2'), buf);
    await writeFile(join(dir, 'cover.avif'), buf);

    const result = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(result.fileCount).toBe(0);
    expect(existsSync(join(dir, 'logo.png.br'))).toBe(false);
    expect(existsSync(join(dir, 'font.woff2.gz'))).toBe(false);
    expect(existsSync(join(dir, 'cover.avif.br'))).toBe(false);
  });

  test('skips files below the 256 B floor', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'tiny.html'), '<p>tiny</p>');
    const result = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(result.fileCount).toBe(0);
    expect(existsSync(join(dir, 'tiny.html.br'))).toBe(false);
    expect(existsSync(join(dir, 'tiny.html.gz'))).toBe(false);
  });

  test('compresses SVG, JS, JSON, XML, txt, map text payloads', async () => {
    const dir = await makeTempOutputDir();
    const payload = 'x'.repeat(2048);
    await writeFile(join(dir, 'icon.svg'), `<svg>${payload}</svg>`);
    await writeFile(join(dir, 'app.js'), `// js\n${payload}`);
    await writeFile(join(dir, 'data.json'), `{"a":"${payload}"}`);
    await writeFile(join(dir, 'sitemap.xml'), `<urlset>${payload}</urlset>`);
    await writeFile(join(dir, 'robots.txt'), payload);
    await writeFile(join(dir, 'app.js.map'), `{"sources":["${payload}"]}`);

    const result = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(result.fileCount).toBe(6);
    for (const ext of ['svg', 'js', 'json', 'xml', 'txt', 'map']) {
      const base =
        ext === 'json'
          ? 'data.json'
          : ext === 'xml'
            ? 'sitemap.xml'
            : ext === 'txt'
              ? 'robots.txt'
              : ext === 'map'
                ? 'app.js.map'
                : ext === 'js'
                  ? 'app.js'
                  : 'icon.svg';
      expect(existsSync(join(dir, `${base}.br`))).toBe(true);
      expect(existsSync(join(dir, `${base}.gz`))).toBe(true);
    }
  });

  test('does not recompress its own .br/.gz output on rerun', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'index.html'), LARGE_HTML);
    await precompressOutput({ outputDir: dir, format: 'both' });
    // Rerun: should see the original .html but NOT walk into .br/.gz to
    // try to compress those (no `.html.br.br` / `.html.gz.gz`).
    const second = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(second.fileCount).toBe(1);
    expect(existsSync(join(dir, 'index.html.br.br'))).toBe(false);
    expect(existsSync(join(dir, 'index.html.gz.gz'))).toBe(false);
  });

  test('format "brotli" emits only .br companions', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'index.html'), LARGE_HTML);
    const result = await precompressOutput({ outputDir: dir, format: 'brotli' });
    expect(result.fileCount).toBe(1);
    expect(existsSync(join(dir, 'index.html.br'))).toBe(true);
    expect(existsSync(join(dir, 'index.html.gz'))).toBe(false);
  });

  test('format "gzip" emits only .gz companions', async () => {
    const dir = await makeTempOutputDir();
    await writeFile(join(dir, 'index.html'), LARGE_HTML);
    const result = await precompressOutput({ outputDir: dir, format: 'gzip' });
    expect(result.fileCount).toBe(1);
    expect(existsSync(join(dir, 'index.html.gz'))).toBe(true);
    expect(existsSync(join(dir, 'index.html.br'))).toBe(false);
    const gz = await readFile(join(dir, 'index.html.gz'));
    expect(gunzipSync(gz).toString('utf8')).toBe(LARGE_HTML);
  });

  test('walks nested directories', async () => {
    const dir = await makeTempOutputDir();
    await mkdir(join(dir, 'a/b/c'), { recursive: true });
    await writeFile(join(dir, 'a/b/c/page.html'), LARGE_HTML);
    const result = await precompressOutput({ outputDir: dir, format: 'both' });
    expect(result.fileCount).toBe(1);
    expect(existsSync(join(dir, 'a/b/c/page.html.br'))).toBe(true);
    expect(existsSync(join(dir, 'a/b/c/page.html.gz'))).toBe(true);
  });
});
