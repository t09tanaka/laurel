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
    expect(doc).toContain('./admin-dashboard-design-system.md');
  });

  test('documents the Admin dashboard design system tokens', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'admin-dashboard-design-system.md'), 'utf8');

    expect(doc).toContain('# Nectar Admin Dashboard Design System');
    expect(doc).toContain('note (https://note.com/)');
    expect(doc).toContain('Text primary: #08131a');
    expect(doc).toContain('Article body: 18px / line-height 2');
    expect(doc).toContain('font-feature-settings "palt"');
    expect(doc).toContain('Readable article width: 620px');
    expect(doc).toContain('prefers-color-scheme: dark');
  });

  test('documents executable visual QA, Ghost comparison criteria, and browser fallbacks', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'admin-dashboard.md'), 'utf8');

    expect(doc).toContain('## Executable Visual QA');
    expect(doc).toContain(
      'bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project',
    );
    expect(doc).toContain('1440x1100');
    expect(doc).toContain('1280x900');
    expect(doc).toContain('390x844');
    expect(doc).toContain('Posts / Pages / Settings / Editor / Conflict / Empty');
    expect(doc).toContain('Browser plugin');
    expect(doc).toContain('Chrome DevTools Protocol');
    expect(doc).toContain('Ghost comparison pass line');
  });

  test('links the Admin design doc from top-level docs', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    const design = await readFile(join(ROOT, 'docs', 'DESIGN.md'), 'utf8');

    expect(readme).toContain('./docs/admin-dashboard.md');
    expect(design).toContain('./admin-dashboard.md');
  });

  test('documents local editor recovery and history privacy boundaries', async () => {
    const doc = await readFile(join(ROOT, 'docs', 'admin-dashboard.md'), 'utf8');

    expect(doc).toContain('localStorage / sessionStorage');
    expect(doc).toContain('保存前 snapshot');
    expect(doc).toContain('fingerprint と path');
    expect(doc).toContain('機密情報');
    expect(doc).toContain('Autosave でファイルへ書き込まない');
  });
});
