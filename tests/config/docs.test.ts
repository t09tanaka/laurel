import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { renderConfigReference } from '~/config/docs.ts';
import { configSchema } from '~/config/schema.ts';

describe('renderConfigReference', () => {
  test('emits the auto-generated banner', () => {
    const md = renderConfigReference();
    expect(md).toContain('AUTO-GENERATED FILE');
    expect(md).toContain('bun run docs:config');
  });

  test('lists every top-level section', () => {
    const md = renderConfigReference();
    const expected = [
      '## `site`',
      '## `theme`',
      '## `content`',
      '## `build`',
      '## `navigation[]`',
      '## `secondary_navigation[]`',
      '## `components`',
      '## `components.rss`',
      '## `components.comments`',
    ];
    for (const heading of expected) {
      expect(md).toContain(heading);
    }
  });

  test('renders every leaf field path from the schema', () => {
    const md = renderConfigReference();
    for (const path of collectLeafPaths(configSchema)) {
      expect(md).toContain(`\`${path}\``);
    }
  });

  test('every described field appears with its description', () => {
    const md = renderConfigReference();
    const described = collectDescriptions(configSchema);
    expect(described.length).toBeGreaterThan(0);
    for (const description of described) {
      expect(md).toContain(description);
    }
  });

  test('marks required fields and renders defaults', () => {
    const md = renderConfigReference();
    expect(md).toMatch(/\| `site\.title` \| `string` \| yes \| — \|/);
    expect(md).toMatch(/\| `site\.url` \| `string` \| no \| `"http:\/\/localhost:4321"` \|/);
    expect(md).toMatch(/\| `build\.posts_per_page` \| `number` \| no \| `12` \|/);
    expect(md).toMatch(/\| `build\.copy_content_assets` \| `boolean` \| no \| `true` \|/);
  });

  test('renders enum unions inline', () => {
    const md = renderConfigReference();
    expect(md).toContain('`"truncate" \\| "render-full" \\| "skip"`');
  });

  test('the checked-in docs/config.md matches the rendered output', async () => {
    const target = resolve(import.meta.dir, '../../docs/config.md');
    const onDisk = await readFile(target, 'utf8');
    const rendered = renderConfigReference();
    expect(onDisk).toBe(rendered);
  });
});

function collectLeafPaths(schema: z.ZodTypeAny, prefix = ''): string[] {
  const inner = unwrapForWalk(schema);
  if (inner instanceof z.ZodObject) {
    const out: string[] = [];
    for (const [key, value] of Object.entries(inner.shape)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const child = unwrapForWalk(value as z.ZodTypeAny);
      if (child instanceof z.ZodObject) {
        out.push(...collectLeafPaths(child, path));
        continue;
      }
      if (child instanceof z.ZodArray) {
        const element = unwrapForWalk(child._def.type);
        if (element instanceof z.ZodObject) {
          out.push(...collectLeafPaths(element, `${path}[]`));
          continue;
        }
      }
      out.push(path);
    }
    return out;
  }
  return [];
}

function collectDescriptions(schema: z.ZodTypeAny): string[] {
  const out: string[] = [];
  const visit = (s: z.ZodTypeAny): void => {
    if (s.description) out.push(s.description);
    const inner = unwrapForWalk(s);
    if (inner !== s && inner.description) out.push(inner.description);
    if (inner instanceof z.ZodObject) {
      for (const value of Object.values(inner.shape)) {
        visit(value as z.ZodTypeAny);
      }
    } else if (inner instanceof z.ZodArray) {
      visit(inner._def.type);
    }
  };
  visit(schema);
  return Array.from(new Set(out));
}

function unwrapForWalk(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodEffects
  ) {
    if (current instanceof z.ZodEffects) {
      current = current._def.schema;
    } else {
      current = current._def.innerType;
    }
  }
  return current;
}
