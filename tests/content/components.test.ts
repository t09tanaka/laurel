import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NectarConfig } from '../../src/config/schema.ts';
import { loadComponents } from '../../src/content/components.ts';

function fakeConfig(componentsDir: string): NectarConfig {
  return {
    content: { components_dir: componentsDir },
  } as unknown as NectarConfig;
}

async function withTempProject(
  files: Record<string, string>,
): Promise<{ cwd: string; config: NectarConfig }> {
  const cwd = await mkdtemp(join(tmpdir(), 'nectar-components-'));
  const componentsDir = 'content/components';
  await mkdir(join(cwd, componentsDir), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(cwd, componentsDir, name), body, 'utf8');
  }
  return { cwd, config: fakeConfig(componentsDir) };
}

describe('loadComponents', () => {
  it('reads slug, description, css, html from a single .md file', async () => {
    const { cwd, config } = await withTempProject({
      'cta.md': `---
slug: cta
description: Buy now
---

\`\`\`css
.cta { color: red }
\`\`\`

\`\`\`html
<button>Buy</button>
\`\`\`
`,
    });
    const list = await loadComponents(cwd, config);
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('cta');
    expect(list[0]?.description).toBe('Buy now');
    expect(list[0]?.css).toBe('.cta { color: red }');
    expect(list[0]?.html).toBe('<button>Buy</button>');
  });

  it('falls back to the filename when frontmatter has no slug', async () => {
    const { cwd, config } = await withTempProject({
      'hero.md': '---\n---\n\n```html\n<h2>Hero</h2>\n```\n',
    });
    const list = await loadComponents(cwd, config);
    expect(list[0]?.slug).toBe('hero');
  });

  it('skips files whose slug does not match the identifier pattern', async () => {
    const { cwd, config } = await withTempProject({
      '0bad.md': '---\nslug: 0bad\n---\n\n```html\n<x></x>\n```\n',
      'good.md': '---\nslug: good\n---\n\n```html\n<x></x>\n```\n',
    });
    const list = await loadComponents(cwd, config);
    expect(list.map((c) => c.slug)).toEqual(['good']);
  });

  it('skips files missing the required ```html block', async () => {
    const { cwd, config } = await withTempProject({
      'noop.md': '---\nslug: noop\n---\n\n```css\n.x{}\n```\n',
    });
    expect(await loadComponents(cwd, config)).toHaveLength(0);
  });

  it('returns empty when the components directory does not exist', async () => {
    const { cwd } = await withTempProject({});
    expect(await loadComponents(cwd, fakeConfig('content/missing'))).toEqual([]);
  });

  it('keeps the first occurrence on duplicate slugs', async () => {
    const { cwd, config } = await withTempProject({
      'a.md': '---\nslug: dup\n---\n\n```html\n<a>1</a>\n```\n',
      'b.md': '---\nslug: dup\n---\n\n```html\n<b>2</b>\n```\n',
    });
    const list = await loadComponents(cwd, config);
    expect(list).toHaveLength(1);
    expect(list[0]?.html).toBe('<a>1</a>');
  });
});
