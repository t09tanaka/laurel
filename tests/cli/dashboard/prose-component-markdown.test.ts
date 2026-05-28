import { describe, expect, test } from 'bun:test';
import MarkdownIt from 'markdown-it';
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as pmSchema,
} from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import {
  componentMarkdownItPlugin,
  componentSerializerNode,
  componentTokenHandler,
} from '../../../src/cli/dashboard/web/lib/prose-component-markdown.ts';
import { componentNodeSpec } from '../../../src/cli/dashboard/web/lib/prose-component-schema.ts';

const components = [
  {
    slug: 'ghost-html-card-a1b2c3d4',
    description: 'Imported banner',
    css: '.banner { display: block; }',
    html: '<figure><a href="https://example.com"><img src="/banner.jpg" alt="Banner"></a></figure>',
  },
];

const schema = new Schema({
  nodes: pmSchema.spec.nodes.append({ component: componentNodeSpec }),
  marks: pmSchema.spec.marks,
});
const md = MarkdownIt('commonmark', { html: false }).use(componentMarkdownItPlugin(components));
const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  component: componentTokenHandler,
});
const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, component: componentSerializerNode },
  defaultMarkdownSerializer.marks,
);

describe('component markdown bridge', () => {
  test('parses a known {slug} line into a component node with preview payload', () => {
    const doc = parser.parse('{ghost-html-card-a1b2c3d4}');
    expect(doc).not.toBeNull();
    const node = doc?.firstChild;
    expect(node?.type.name).toBe('component');
    expect(node?.attrs.slug).toBe('ghost-html-card-a1b2c3d4');
    expect(node?.attrs.description).toBe('Imported banner');
    expect(node?.attrs.css).toContain('.banner');
    expect(node?.attrs.html).toContain('<figure>');
  });

  test('leaves unknown component-like text as a normal paragraph', () => {
    const doc = parser.parse('{missing-component}');
    expect(doc?.firstChild?.type.name).toBe('paragraph');
    expect(doc?.textContent).toBe('{missing-component}');
  });

  test('serialises a component node back to a clean shortcode line', () => {
    const doc = parser.parse('{ghost-html-card-a1b2c3d4}');
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(serializer.serialize(doc).trim()).toBe('{ghost-html-card-a1b2c3d4}');
  });
});
