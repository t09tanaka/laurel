import { describe, expect, test } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import {
  COMPONENT_ATTR_KEYS,
  componentNodeSpec,
} from '../../../src/cli/dashboard/web/lib/prose-component-schema.ts';

const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({ component: componentNodeSpec }),
  marks: basicSchema.spec.marks,
});

function componentType() {
  const type = schema.nodes.component;
  if (!type) throw new Error('component node type is missing');
  return type;
}

describe('componentNodeSpec', () => {
  test('lists the attrs used by editor previews', () => {
    expect(COMPONENT_ATTR_KEYS).toEqual(['slug', 'description', 'css', 'html']);
  });

  test('creates a block atom with default empty attrs', () => {
    const node = componentType().create();
    expect(node.type.name).toBe('component');
    expect(node.isAtom).toBe(true);
    expect(node.isBlock).toBe(true);
    expect(node.attrs.slug).toBe('');
    expect(node.attrs.html).toBe('');
  });

  test('round-trips preview payload through attrs', () => {
    const node = componentType().create({
      slug: 'callout',
      description: 'Inline notice',
      css: '.callout{}',
      html: '<div class="callout">Hi</div>',
    });
    expect(node.attrs.slug).toBe('callout');
    expect(node.attrs.description).toBe('Inline notice');
    expect(node.attrs.css).toBe('.callout{}');
    expect(node.attrs.html).toContain('callout');
  });
});
