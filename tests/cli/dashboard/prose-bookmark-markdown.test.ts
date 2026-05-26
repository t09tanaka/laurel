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
  bookmarkMarkdownItPlugin,
  bookmarkSerializerNode,
  bookmarkTokenHandler,
} from '../../../src/cli/dashboard/web/lib/prose-bookmark-markdown.ts';
import { bookmarkNodeSpec } from '../../../src/cli/dashboard/web/lib/prose-bookmark-schema.ts';

// Use the prosemirror-markdown schema as base because defaultMarkdownParser.tokens
// references list_item/bullet_list/ordered_list which basicSchema omits.
const schema = new Schema({
  nodes: pmSchema.spec.nodes.append({ bookmark: bookmarkNodeSpec }),
  marks: pmSchema.spec.marks,
});

const md = MarkdownIt('commonmark', { html: false }).use(bookmarkMarkdownItPlugin);
const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  bookmark: bookmarkTokenHandler,
});
const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, bookmark: bookmarkSerializerNode },
  defaultMarkdownSerializer.marks,
);

const FULL = `{{< bookmark url="https://example.com/post" title="Hello" description="Desc" icon="https://example.com/favicon.ico" thumbnail="https://example.com/og.png" author="A" publisher="P" caption="C" />}}`;

describe('bookmark markdown bridge', () => {
  test('parses a full-attr shortcode into a bookmark node', () => {
    const doc = parser.parse(FULL);
    expect(doc).not.toBeNull();
    const node = doc?.firstChild;
    expect(node?.type.name).toBe('bookmark');
    expect(node?.attrs.url).toBe('https://example.com/post');
    expect(node?.attrs.title).toBe('Hello');
    expect(node?.attrs.caption).toBe('C');
  });

  test('serialises a bookmark node back to the same shortcode (round-trip)', () => {
    const doc = parser.parse(FULL);
    expect(doc).not.toBeNull();
    if (!doc) return;
    const out = serializer.serialize(doc).trim();
    expect(out).toBe(FULL);
  });

  test('omits empty attrs when serialising', () => {
    const node = schema.nodes.bookmark.create({
      url: 'https://example.com/',
      title: 'T',
      description: '',
      icon: '',
      thumbnail: '',
      author: '',
      publisher: '',
      caption: '',
    });
    const doc = schema.node('doc', null, [node]);
    const out = serializer.serialize(doc).trim();
    expect(out).toBe('{{< bookmark url="https://example.com/" title="T" />}}');
  });

  test('round-trips embedded quotes via backslash escaping', () => {
    const md1 = `{{< bookmark url="https://example.com/" title="He said \\"hi\\"" />}}`;
    const doc = parser.parse(md1);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.firstChild?.attrs.title).toBe('He said "hi"');
    const out = serializer.serialize(doc).trim();
    expect(out).toBe(md1);
  });

  test('does not treat ordinary paragraphs starting with `{` as bookmarks', () => {
    const doc = parser.parse('{not a bookmark}');
    expect(doc?.firstChild?.type.name).toBe('paragraph');
  });
});
