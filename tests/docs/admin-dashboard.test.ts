import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

describe('Admin dashboard design docs', () => {
  test('documents the file-first Admin scope and Ghost boundaries', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'admin-dashboard.md'), 'utf8');

    expect(doc).toContain('file-first / Markdown-first / static publishing');
    expect(doc).toContain('Posts / Pages / Authors / Tags / Settings');
    expect(doc).toContain('Email / newsletter / members / paid tiers');
    expect(doc).toContain('Ghost Admin と Ghost Editor は研究対象');
    expect(doc).toContain('Koenig / Lexical の内部データモデルを移植しない');
  });

  test('documents IA, North Star, personas, visual review, and rollout', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'admin-dashboard.md'), 'utf8');

    expect(doc).toContain('## North Star');
    expect(doc).toContain('## Personas and Jobs');
    expect(doc).toContain('## Information Architecture');
    expect(doc).toContain('## Visual and Brand Direction');
    expect(doc).toContain('## Ghost Reference Board');
    expect(doc).toContain('## Rollout Plan');
    expect(doc).toContain('API/test foundation');
  });

  test('links the Admin design doc from top-level docs', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    const design = await readFile(join(ROOT, 'docs', 'DESIGN.md'), 'utf8');

    expect(readme).toContain('./docs/admin-dashboard.md');
    expect(design).toContain('./admin-dashboard.md');
  });
});
