import { describe, expect, test } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { EditorState, TextSelection } from 'prosemirror-state';
import { tableNodes } from 'prosemirror-tables';
import { _internal } from '../../../src/cli/dashboard/web/lib/prose-insert-menu.ts';

// Mirror the editor's runtime schema so the trigger logic exercises
// the same node types ProseEditor wires up.
const baseNodes = basicSchema.spec.nodes;
const withList = addListNodes(baseNodes, 'paragraph block*', 'block');
const fullNodes = withList.append(
  tableNodes({ tableGroup: 'block', cellContent: 'inline*', cellAttributes: {} }),
);
const proseSchema = new Schema({ nodes: fullNodes, marks: basicSchema.spec.marks });

function makeStateFromText(text: string): EditorState {
  const doc = proseSchema.node('doc', null, [
    proseSchema.node('paragraph', null, text ? [proseSchema.text(text)] : []),
  ]);
  const state = EditorState.create({ schema: proseSchema, doc });
  // Selection at end of the paragraph (which for empty text == start).
  const sel = TextSelection.create(state.doc, 1);
  return state.apply(state.tr.setSelection(sel));
}

describe('prose-insert-menu — findEmptyParagraph trigger', () => {
  test('fires on an empty top-level paragraph with an empty cursor selection', () => {
    const state = makeStateFromText('');
    const target = _internal.findEmptyParagraph(state);
    expect(target).not.toBeNull();
    expect(target?.paraStart).toBe(0);
  });

  test('does not fire when the paragraph has content', () => {
    const state = makeStateFromText('hello');
    expect(_internal.findEmptyParagraph(state)).toBeNull();
  });

  test('does not fire when the selection spans a range', () => {
    const base = makeStateFromText('hello');
    const sel = TextSelection.create(base.doc, 1, 4);
    const state = base.apply(base.tr.setSelection(sel));
    expect(_internal.findEmptyParagraph(state)).toBeNull();
  });

  test('does not fire inside a nested block (blockquote)', () => {
    const doc = proseSchema.node('doc', null, [
      proseSchema.node('blockquote', null, [proseSchema.node('paragraph', null, [])]),
    ]);
    const base = EditorState.create({ schema: proseSchema, doc });
    // Place cursor inside the inner empty paragraph (depth=2).
    const sel = TextSelection.create(base.doc, 2);
    const state = base.apply(base.tr.setSelection(sel));
    expect(_internal.findEmptyParagraph(state)).toBeNull();
  });
});

describe('prose-insert-menu — build3x3Table', () => {
  test('produces a 3x3 table (1 header row + 2 body rows × 3 cells)', () => {
    const table = _internal.build3x3Table(proseSchema);
    expect(table).not.toBeNull();
    if (!table) return;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    const headerRow = table.child(0);
    expect(headerRow.type.name).toBe('table_row');
    expect(headerRow.childCount).toBe(3);
    expect(headerRow.child(0).type.name).toBe('table_header');
    const body1 = table.child(1);
    expect(body1.childCount).toBe(3);
    expect(body1.child(0).type.name).toBe('table_cell');
  });
});

describe('prose-insert-menu — altFromFilenameDefault', () => {
  test('strips extension and normalises separators', () => {
    expect(_internal.altFromFilenameDefault('a_nice-photo.jpg')).toBe('a nice photo');
    expect(_internal.altFromFilenameDefault('photo.PNG')).toBe('photo');
    expect(_internal.altFromFilenameDefault('.hidden')).toBe('image');
    expect(_internal.altFromFilenameDefault('')).toBe('image');
  });
});
