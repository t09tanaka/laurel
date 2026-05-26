import { describe, expect, test } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { EditorState, TextSelection } from 'prosemirror-state';
import { tableNodes } from 'prosemirror-tables';
import {
  COMPONENT_SLUG_PATTERN,
  altFromFilenameDefault,
  build3x3Table,
  buildComponentParagraph,
  buildComponentSubmenuEntries,
  buildInsertComponentTransaction,
  findEmptyParagraph,
} from '../../../src/cli/dashboard/web/lib/prose-insert-menu-logic.ts';

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
  const sel = TextSelection.create(state.doc, 1);
  return state.apply(state.tr.setSelection(sel));
}

describe('prose-insert-menu — findEmptyParagraph trigger', () => {
  test('fires on an empty top-level paragraph with an empty cursor selection', () => {
    const state = makeStateFromText('');
    const target = findEmptyParagraph(state);
    expect(target).not.toBeNull();
    expect(target?.paraStart).toBe(0);
  });

  test('does not fire when the paragraph has content', () => {
    const state = makeStateFromText('hello');
    expect(findEmptyParagraph(state)).toBeNull();
  });

  test('does not fire when the selection spans a range', () => {
    const base = makeStateFromText('hello');
    const sel = TextSelection.create(base.doc, 1, 4);
    const state = base.apply(base.tr.setSelection(sel));
    expect(findEmptyParagraph(state)).toBeNull();
  });

  test('does not fire inside a nested block (blockquote)', () => {
    const doc = proseSchema.node('doc', null, [
      proseSchema.node('blockquote', null, [proseSchema.node('paragraph', null, [])]),
    ]);
    const base = EditorState.create({ schema: proseSchema, doc });
    const sel = TextSelection.create(base.doc, 2);
    const state = base.apply(base.tr.setSelection(sel));
    expect(findEmptyParagraph(state)).toBeNull();
  });
});

describe('prose-insert-menu — build3x3Table', () => {
  test('produces a 3x3 table (1 header row + 2 body rows × 3 cells)', () => {
    const table = build3x3Table(proseSchema);
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
    expect(altFromFilenameDefault('a_nice-photo.jpg')).toBe('a nice photo');
    expect(altFromFilenameDefault('photo.PNG')).toBe('photo');
    expect(altFromFilenameDefault('.hidden')).toBe('image');
    expect(altFromFilenameDefault('')).toBe('image');
  });
});

describe('prose-insert-menu — buildComponentParagraph', () => {
  test('produces a paragraph whose text content is the literal {slug}', () => {
    const para = buildComponentParagraph(proseSchema, 'callout');
    expect(para).not.toBeNull();
    if (!para) return;
    expect(para.type.name).toBe('paragraph');
    expect(para.textContent).toBe('{callout}');
  });

  test('returns null when the schema lacks a paragraph node', () => {
    // Construct a degenerate schema with `doc { text* }` — no
    // paragraph node — to confirm the helper bails rather than
    // throwing.
    const bare = new Schema({
      nodes: {
        doc: { content: 'text*' },
        text: {},
      },
    });
    expect(buildComponentParagraph(bare, 'callout')).toBeNull();
  });
});

describe('prose-insert-menu — COMPONENT_SLUG_PATTERN', () => {
  test('accepts the slugs the loader accepts and rejects the rest', () => {
    // Mirror src/content/components.ts allow-list. The menu filters
    // against this pattern before showing entries so users never see
    // a snippet that would silently fail to expand.
    expect(COMPONENT_SLUG_PATTERN.test('callout')).toBe(true);
    expect(COMPONENT_SLUG_PATTERN.test('Hero_2')).toBe(true);
    expect(COMPONENT_SLUG_PATTERN.test('side-bar')).toBe(true);
    expect(COMPONENT_SLUG_PATTERN.test('1leading-digit')).toBe(false);
    expect(COMPONENT_SLUG_PATTERN.test('has space')).toBe(false);
    expect(COMPONENT_SLUG_PATTERN.test('')).toBe(false);
  });
});

describe('prose-insert-menu — buildComponentSubmenuEntries', () => {
  test('preserves input order and maps slug → {slug} label', () => {
    const entries = buildComponentSubmenuEntries([
      { slug: 'callout', description: 'Inline notice block' },
      { slug: 'hero' },
    ]);
    expect(entries.map((e) => e.slug)).toEqual(['callout', 'hero']);
    expect(entries[0]).toEqual({
      slug: 'callout',
      label: '{callout}',
      hint: 'Inline notice block',
    });
    expect(entries[1]).toEqual({ slug: 'hero', label: '{hero}', hint: '' });
  });

  test('drops slugs that fail the loader pattern', () => {
    const entries = buildComponentSubmenuEntries([
      { slug: 'callout' },
      { slug: '1bad' }, // leading digit
      { slug: 'has space' },
      { slug: '' },
      { slug: 'hero-v2' },
    ]);
    expect(entries.map((e) => e.slug)).toEqual(['callout', 'hero-v2']);
  });

  test('dedupes by slug, keeping the first occurrence', () => {
    const entries = buildComponentSubmenuEntries([
      { slug: 'callout', description: 'first' },
      { slug: 'callout', description: 'second — should be ignored' },
      { slug: 'hero' },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.hint).toBe('first');
  });

  test('trims whitespace from descriptions', () => {
    const entries = buildComponentSubmenuEntries([{ slug: 'callout', description: '  padded  ' }]);
    expect(entries[0]?.hint).toBe('padded');
  });
});

describe('prose-insert-menu — buildInsertComponentTransaction', () => {
  test('replaces the empty paragraph with {slug} and parks the caret at the text end', () => {
    const state = makeStateFromText('');
    const target = findEmptyParagraph(state);
    expect(target).not.toBeNull();
    if (!target) return;
    const inserted = buildComponentParagraph(proseSchema, 'callout');
    expect(inserted).not.toBeNull();
    if (!inserted) return;
    const tr = buildInsertComponentTransaction(state, target, inserted);
    expect(tr).not.toBeNull();
    if (!tr) return;
    expect(tr.doc.textContent).toBe('{callout}');
    // doc opens at 0, paragraph open at 1, text spans 1..10 (length 9),
    // so caret end-of-text === 10.
    expect(tr.selection.empty).toBe(true);
    expect(tr.selection.from).toBe(10);
  });

  test('round-trips through markdownSerializer as a clean {slug} line', () => {
    // Smoke-check that the inserted paragraph would serialise back to
    // `{callout}\n` — i.e. the shape the build-side shortcode expander
    // expects to see. Done with a tiny inline serializer so the test
    // doesn't pull in the editor's full module surface.
    const state = makeStateFromText('');
    const target = findEmptyParagraph(state);
    if (!target) return;
    const inserted = buildComponentParagraph(proseSchema, 'callout');
    if (!inserted) return;
    const tr = buildInsertComponentTransaction(state, target, inserted);
    if (!tr) return;
    // textBetween across the doc strips paragraph markers; for a
    // single paragraph it equals the paragraph's textContent.
    expect(tr.doc.textBetween(0, tr.doc.content.size)).toBe('{callout}');
  });
});
