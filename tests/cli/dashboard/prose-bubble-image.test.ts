import { describe, expect, test } from 'bun:test';
import { type NodeType, Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { tableNodes } from 'prosemirror-tables';
import { getImageSelection } from '../../../src/cli/dashboard/web/lib/prose-bubble-menu-logic.ts';

const baseNodes = basicSchema.spec.nodes;
const withList = addListNodes(baseNodes, 'paragraph block*', 'block');
const fullNodes = withList.append(
  tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} }),
);
const proseSchema = new Schema({ nodes: fullNodes, marks: basicSchema.spec.marks });

function nodeType(name: string): NodeType {
  const t = proseSchema.nodes[name];
  if (!t) throw new Error(`prose schema missing node: ${name}`);
  return t;
}

function makeStateWithImage(altText: string): EditorState {
  const image = nodeType('image').create({ src: '/img/x.png', alt: altText });
  const doc = proseSchema.node('doc', null, [proseSchema.node('paragraph', null, [image])]);
  const base = EditorState.create({ schema: proseSchema, doc });
  // Image sits at position 1 (paragraph starts at 0, content at 1).
  const sel = NodeSelection.create(base.doc, 1);
  return base.apply(base.tr.setSelection(sel));
}

describe('prose-bubble-menu — getImageSelection', () => {
  test('detects an image NodeSelection and returns the node + position', () => {
    const state = makeStateWithImage('original alt');
    const result = getImageSelection(state);
    expect(result).not.toBeNull();
    expect(result?.node.type.name).toBe('image');
    expect(result?.node.attrs.alt).toBe('original alt');
    expect(result?.pos).toBe(1);
  });

  test('returns null when the selection is a TextSelection (not a NodeSelection)', () => {
    const doc = proseSchema.node('doc', null, [
      proseSchema.node('paragraph', null, [proseSchema.text('hello')]),
    ]);
    const base = EditorState.create({ schema: proseSchema, doc });
    const sel = TextSelection.create(base.doc, 1, 4);
    const state = base.apply(base.tr.setSelection(sel));
    expect(getImageSelection(state)).toBeNull();
  });

  test('returns null when a non-image node is selected', () => {
    const hr = nodeType('horizontal_rule').create();
    const doc = proseSchema.node('doc', null, [
      proseSchema.node('paragraph', null, []),
      hr,
      proseSchema.node('paragraph', null, []),
    ]);
    const base = EditorState.create({ schema: proseSchema, doc });
    // hr lives at position 2 (after the first empty paragraph).
    const sel = NodeSelection.create(base.doc, 2);
    const state = base.apply(base.tr.setSelection(sel));
    expect(getImageSelection(state)).toBeNull();
  });
});

describe('prose-bubble-menu — image alt edit + delete behaviour', () => {
  test('setNodeMarkup updates the image alt while preserving other attrs', () => {
    const state = makeStateWithImage('old');
    const sel = getImageSelection(state);
    if (!sel) throw new Error('expected image selection');
    const newAttrs = { ...sel.node.attrs, alt: 'new alt' };
    const next = state.apply(state.tr.setNodeMarkup(sel.pos, null, newAttrs));
    const updated = next.doc.nodeAt(sel.pos);
    expect(updated?.type.name).toBe('image');
    expect(updated?.attrs.alt).toBe('new alt');
    expect(updated?.attrs.src).toBe('/img/x.png');
  });

  test('tr.delete on the image NodeSelection range removes the image from the doc', () => {
    const state = makeStateWithImage('any');
    const { from, to } = state.selection;
    const next = state.apply(state.tr.delete(from, to));
    // The paragraph remains; the image is gone.
    expect(next.doc.firstChild?.type.name).toBe('paragraph');
    expect(next.doc.firstChild?.content.size).toBe(0);
  });
});
