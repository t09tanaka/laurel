import { describe, expect, test } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import {
  BOOKMARK_ATTR_KEYS,
  bookmarkNodeSpec,
} from '../../../src/cli/dashboard/web/lib/prose-bookmark-schema.ts';

const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({ bookmark: bookmarkNodeSpec }),
  marks: basicSchema.spec.marks,
});

function bookmarkType() {
  const type = schema.nodes.bookmark;
  if (!type) throw new Error('bookmark node type is missing');
  return type;
}

describe('bookmarkNodeSpec', () => {
  test('lists the eight attrs', () => {
    expect(BOOKMARK_ATTR_KEYS).toEqual([
      'url',
      'title',
      'description',
      'icon',
      'thumbnail',
      'author',
      'publisher',
      'caption',
    ]);
  });

  test('creates a node with default empty attrs', () => {
    const node = bookmarkType().create();
    for (const key of BOOKMARK_ATTR_KEYS) {
      expect(node.attrs[key]).toBe('');
    }
  });

  test('round-trips attrs via create', () => {
    const node = bookmarkType().create({
      url: 'https://example.com/',
      title: 'T',
      description: 'D',
      icon: 'https://example.com/favicon.ico',
      thumbnail: 'https://example.com/og.png',
      author: 'A',
      publisher: 'P',
      caption: 'C',
    });
    expect(node.attrs.url).toBe('https://example.com/');
    expect(node.attrs.caption).toBe('C');
  });

  test('is a block atom (no inner content)', () => {
    const type = bookmarkType();
    expect(type.spec.atom).toBe(true);
    expect(type.isAtom).toBe(true);
    expect(type.isBlock).toBe(true);
  });
});
