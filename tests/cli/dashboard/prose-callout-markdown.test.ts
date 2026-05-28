import { describe, expect, test } from 'bun:test';
import MarkdownIt from 'markdown-it';
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as pmSchema,
} from 'prosemirror-markdown';
import { type Node as ProseNode, Schema } from 'prosemirror-model';
import {
  calloutMarkdownItPlugin,
  calloutSerializerNode,
  calloutTokenHandler,
  parseCalloutAttrs,
} from '../../../src/cli/dashboard/web/lib/prose-callout-markdown.ts';
import { calloutNodeSpec } from '../../../src/cli/dashboard/web/lib/prose-callout-schema.ts';

// prosemirror-markdown's base schema carries paragraph / list / blockquote so
// callout's `block+` body has node types to land in.
const schema = new Schema({
  nodes: pmSchema.spec.nodes.append({ callout: calloutNodeSpec }),
  marks: pmSchema.spec.marks,
});

const md = MarkdownIt('commonmark', { html: false }).use(calloutMarkdownItPlugin);
const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  callout: calloutTokenHandler,
});
const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, callout: calloutSerializerNode },
  defaultMarkdownSerializer.marks,
);

function firstCallout(markdown: string): ProseNode {
  const doc = parser.parse(markdown);
  if (!doc) throw new Error('parse returned null');
  const node = doc.firstChild;
  if (!node) throw new Error('doc has no children');
  return node;
}

describe('parseCalloutAttrs', () => {
  test('splits known attrs from passthrough extras', () => {
    const attrs = parseCalloutAttrs(' emoji="✏️" color="white" width="wide"');
    expect(attrs.emoji).toBe('✏️');
    expect(attrs.color).toBe('white');
    expect(attrs.noIcon).toBe(false);
    expect(attrs.extra).toEqual({ width: 'wide' });
  });

  test('clamps an unknown colour token to grey', () => {
    expect(parseCalloutAttrs(' color="neon onclick=alert"').color).toBe('grey');
  });

  test('reads no-icon as a boolean', () => {
    expect(parseCalloutAttrs(' no-icon="true"').noIcon).toBe(true);
  });
});

describe('callout markdown bridge', () => {
  test('parses a single-line callout into a node with body', () => {
    const node = firstCallout('{{< callout emoji="✏️" color="white" >}}Hello world{{< /callout >}}');
    expect(node.type.name).toBe('callout');
    expect(node.attrs.emoji).toBe('✏️');
    expect(node.attrs.color).toBe('white');
    expect(node.textContent).toBe('Hello world');
  });

  test('parses a multi-line callout', () => {
    const src = '{{< callout emoji="💡" color="blue" >}}\n\nLine one\n\n{{< /callout >}}';
    const node = firstCallout(src);
    expect(node.type.name).toBe('callout');
    expect(node.attrs.color).toBe('blue');
    expect(node.textContent).toBe('Line one');
  });

  test('round-trips stably (parse -> serialize -> parse)', () => {
    const doc = parser.parse(
      '{{< callout emoji="✏️" color="white" >}}Hello **world**{{< /callout >}}',
    );
    if (!doc) throw new Error('parse returned null');
    const out = serializer.serialize(doc);
    expect(out).toContain('{{< callout emoji="✏️" color="white" >}}');
    expect(out).toContain('{{< /callout >}}');
    const reparsed = parser.parse(out);
    if (!reparsed) throw new Error('reparse returned null');
    expect(reparsed.eq(doc)).toBe(true);
  });

  test('preserves passthrough extras across a round-trip', () => {
    const node = firstCallout(
      '{{< callout emoji="💡" color="green" width="wide" >}}Body{{< /callout >}}',
    );
    expect(node.attrs.extra).toEqual({ width: 'wide' });
    const doc = schema.node('doc', null, [node]);
    const out = serializer.serialize(doc);
    expect(out).toContain('width="wide"');
  });

  test('serialises no-icon and re-parses it', () => {
    const node = firstCallout('{{< callout color="red" no-icon="true" >}}Quiet{{< /callout >}}');
    expect(node.attrs.noIcon).toBe(true);
    const doc = schema.node('doc', null, [node]);
    const out = serializer.serialize(doc);
    expect(out).toContain('no-icon="true"');
    expect(firstCallout(out).attrs.noIcon).toBe(true);
  });

  test('accepts the liquid delimiter and normalises to the angle form', () => {
    const node = firstCallout('{% callout emoji="🔥" color="yellow" %}Hot{% /callout %}');
    expect(node.type.name).toBe('callout');
    expect(node.attrs.emoji).toBe('🔥');
    const doc = schema.node('doc', null, [node]);
    const out = serializer.serialize(doc);
    expect(out).toContain('{{< callout');
    expect(out).not.toContain('{%');
  });

  test('backfills an empty paragraph for an empty body', () => {
    const node = firstCallout('{{< callout color="grey" >}}{{< /callout >}}');
    expect(node.type.name).toBe('callout');
    expect(node.childCount).toBe(1);
    expect(node.firstChild?.type.name).toBe('paragraph');
  });

  test('leaves an unterminated callout as an ordinary paragraph', () => {
    const doc = parser.parse('{{< callout color="blue" >}}no closing tag here');
    expect(doc?.firstChild?.type.name).toBe('paragraph');
  });

  test('does not expand a callout inside a fenced code block', () => {
    const src = '```\n{{< callout >}}x{{< /callout >}}\n```';
    const doc = parser.parse(src);
    expect(doc?.firstChild?.type.name).toBe('code_block');
  });
});
