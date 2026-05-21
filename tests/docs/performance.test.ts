import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('performance documentation', () => {
  const doc = readFileSync('docs/PERFORMANCE.md', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  const bench = readFileSync('tests/bench/performance.bench.ts', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  test('documents the required target metrics and operating guidance', () => {
    expect(doc).toContain('Full build for 1k posts');
    expect(doc).toContain('<3s');
    expect(doc).toContain('<0.5ms/route');
    expect(doc).toContain('Cache-Control: public, max-age=31536000, immutable');
    expect(doc).toContain('max 5MB');
    expect(doc).toContain('Prefer WebP or AVIF');
    expect(doc).toContain('Worked example: incremental builds');
  });

  test('README links to the performance guide', () => {
    expect(readme).toContain('[`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md)');
  });

  test('manual benchmark script is discoverable and prints results', () => {
    expect(pkg.scripts?.['bench:performance']).toBe('bun tests/bench/performance.bench.ts');
    expect(bench).toContain('Nectar performance benchmark');
    expect(bench).toContain('full build 1k posts <3s');
    expect(bench).toContain('render <0.5ms/route average');
  });
});
