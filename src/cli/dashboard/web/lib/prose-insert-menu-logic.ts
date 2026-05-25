// Pure logic for the "+ insert" menu — no DOM access. Split out
// from prose-insert-menu.ts so the root tsconfig (which excludes the
// dashboard/web tree to keep DOM types out of the SSG build) can
// safely include this module via tests.

import type { NodeType, Node as ProseNode, Schema } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export interface EmptyParagraphTarget {
  paraStart: number;
  caretPos: number;
}

export function altFromFilenameDefault(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return base.length > 0 ? base : 'image';
}

// True iff the cursor sits on an empty top-level paragraph. We
// restrict to depth=1 deliberately: empty paragraphs inside
// blockquotes / list items / table cells are natural targets for
// typing, not block-level insertion. The bubble menu already handles
// formatting inside those contexts.
export function findEmptyParagraph(state: EditorState): EmptyParagraphTarget | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if ($from.parent.type.name !== 'paragraph') return null;
  if ($from.parent.content.size !== 0) return null;
  if ($from.depth !== 1) return null;
  return { paraStart: $from.before(), caretPos: selection.from };
}

export function nodeBy(schema: Schema, name: string): NodeType | null {
  return schema.nodes[name] ?? null;
}

export function build3x3Table(schema: Schema): ProseNode | null {
  const table = nodeBy(schema, 'table');
  const row = nodeBy(schema, 'table_row');
  const header = nodeBy(schema, 'table_header');
  const cell = nodeBy(schema, 'table_cell');
  if (!table || !row || !header || !cell) return null;
  const headerCells: ProseNode[] = [];
  for (let i = 0; i < 3; i += 1) {
    const filled = header.createAndFill();
    if (!filled) return null;
    headerCells.push(filled);
  }
  const headerRow = row.create(null, headerCells);
  const bodyRows: ProseNode[] = [];
  for (let r = 0; r < 2; r += 1) {
    const cells: ProseNode[] = [];
    for (let c = 0; c < 3; c += 1) {
      const filled = cell.createAndFill();
      if (!filled) return null;
      cells.push(filled);
    }
    bodyRows.push(row.create(null, cells));
  }
  return table.create(null, [headerRow, ...bodyRows]);
}
