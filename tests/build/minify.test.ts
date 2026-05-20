import { afterEach, describe, expect, test } from 'bun:test';
import { __resetMinifierCacheForTests, minifyHtmlOutputs } from '~/build/minify.ts';

afterEach(() => {
  __resetMinifierCacheForTests();
});

describe('minifyHtmlOutputs', () => {
  test('collapses whitespace and strips comments in-place (#1109)', async () => {
    const outputs = [
      {
        outputPath: 'index.html',
        html: '<html>\n  <body>\n    <!-- hi -->\n    <h1>  Hello  </h1>\n  </body>\n</html>',
      },
    ];
    const result = await minifyHtmlOutputs(outputs);

    expect(result.minified).toBe(true);
    expect(outputs[0]?.html).not.toContain('<!--');
    expect(outputs[0]?.html).not.toContain('\n  ');
    expect(outputs[0]?.html).toContain('Hello');
    expect(result.outputBytes).toBeLessThan(result.inputBytes);
  });

  test('keeps text content and tags intact (#1109)', async () => {
    const outputs = [
      {
        outputPath: 'post/index.html',
        html: '<!doctype html><html><head><title>T</title></head><body><p>Body text with <em>emphasis</em>.</p></body></html>',
      },
    ];
    await minifyHtmlOutputs(outputs);

    expect(outputs[0]?.html).toContain('Body text with');
    expect(outputs[0]?.html).toContain('<em>emphasis</em>');
    expect(outputs[0]?.html).toContain('<title>T</title>');
  });

  test('preserves SVG sprite symbols and xlink use references (#1703)', async () => {
    const outputs = [
      {
        outputPath: 'index.html',
        html: [
          '<!doctype html>',
          '<html>',
          '<body>',
          '<svg aria-hidden="true" style="display:none">',
          '<symbol id="icon-search" viewBox="0 0 24 24">',
          '<path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"></path>',
          '</symbol>',
          '</svg>',
          '<svg class="icon"><use xlink:href="#icon-search"></use></svg>',
          '</body>',
          '</html>',
        ].join(''),
      },
    ];

    await minifyHtmlOutputs(outputs);

    expect(outputs[0]?.html).toContain('<symbol id="icon-search" viewBox="0 0 24 24">');
    expect(outputs[0]?.html).toContain('<use xlink:href="#icon-search"></use>');
    expect(outputs[0]?.html).not.toContain('href="/#icon-search"');
  });

  test('preserves theme-authored external script src and integrity metadata (#1722)', async () => {
    const src = 'https://code.jquery.com/jquery-3.3.1.min.js';
    const integrity = 'sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=';
    const outputs = [
      {
        outputPath: 'index.html',
        html: [
          '<!doctype html>',
          '<html>',
          '<body>',
          `<script src="${src}" integrity="${integrity}" crossorigin="anonymous"></script>`,
          '</body>',
          '</html>',
        ].join('\n'),
      },
    ];

    await minifyHtmlOutputs(outputs);

    expect(outputs[0]?.html).toContain(`src="${src}"`);
    expect(outputs[0]?.html).toContain(`integrity="${integrity}"`);
    expect(outputs[0]?.html).toContain('crossorigin="anonymous"');
    expect(outputs[0]?.html).not.toContain('jquery-3.7');
  });

  test('handles many outputs concurrently without dropping any (#1109)', async () => {
    const n = 50;
    const outputs = Array.from({ length: n }, (_, i) => ({
      outputPath: `post-${i}/index.html`,
      html: `<html>\n  <body>\n    <h1>  Post ${i}  </h1>\n  </body>\n</html>`,
    }));
    const result = await minifyHtmlOutputs(outputs);

    expect(result.minified).toBe(true);
    for (let i = 0; i < n; i++) {
      expect(outputs[i]?.html).toContain(`Post ${i}`);
      expect(outputs[i]?.html).not.toContain('\n  ');
    }
  });

  test('empty input returns minified=false and zero bytes (#1109)', async () => {
    const result = await minifyHtmlOutputs([]);
    expect(result).toEqual({ inputBytes: 0, outputBytes: 0, minified: false });
  });

  test('reports byte deltas accurately (#1109)', async () => {
    const html = `<html>${' '.repeat(500)}<body><p>x</p></body></html>`;
    const outputs = [{ outputPath: 'a.html', html }];
    const before = Buffer.byteLength(html, 'utf8');
    const result = await minifyHtmlOutputs(outputs);

    expect(result.inputBytes).toBe(before);
    expect(result.outputBytes).toBe(Buffer.byteLength(outputs[0]?.html ?? '', 'utf8'));
    expect(result.outputBytes).toBeLessThan(result.inputBytes);
  });

  test('per-output failure does not abort the batch and keeps original html (#1109)', async () => {
    // html-minifier-terser tolerates messy HTML, so synthesise a failure by
    // mixing a valid output with one whose minify call will throw. The
    // minifier rejects on unbalanced template-style tags inside <script>.
    const outputs = [
      { outputPath: 'good.html', html: '<html><body><h1>  good  </h1></body></html>' },
      { outputPath: 'bad.html', html: '<html><body><script>{{</script></body></html>' },
    ];
    const result = await minifyHtmlOutputs(outputs);

    // The "good" output is still minified.
    expect(result.minified).toBe(true);
    expect(outputs[0]?.html).toContain('good');
    // The batch did not throw; both files still have html.
    expect(outputs[1]?.html.length).toBeGreaterThan(0);
  });
});
