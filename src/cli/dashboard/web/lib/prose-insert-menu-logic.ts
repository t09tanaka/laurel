// Pure logic for the "+ insert" menu — no DOM access. Split out
// from prose-insert-menu.ts so the root tsconfig (which excludes the
// dashboard/web tree to keep DOM types out of the SSG build) can
// safely include this module via tests.

import type { NodeType, Node as ProseNode, Schema } from 'prosemirror-model';
import {
  type EditorState,
  NodeSelection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';

export interface EmptyParagraphTarget {
  paraStart: number;
  caretPos: number;
}

// Surface for the "Components" submenu in the insert popover. We
// keep this minimal — the menu only needs the slug (for the inserted
// `{slug}` text) and an optional description for the hint text.
export interface ComponentEntry {
  slug: string;
  description?: string;
  css?: string;
  html?: string;
}

// Slug pattern mirrored from src/content/components.ts so a defensive
// filter at insert time drops anything that wouldn't actually expand
// at render time. Loose components (typos, kebab-case, etc.) are
// hidden from the submenu rather than letting users insert dead text.
export const COMPONENT_SLUG_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Build the block used for a component insertion. Modern editor schemas
// expose a dedicated atom node so `{slug}` renders as a non-editable
// preview; older / test schemas fall back to a paragraph containing
// the literal shortcode text.
export function buildComponentParagraph(
  schema: Schema,
  slug: string,
  entry?: ComponentEntry,
): ProseNode | null {
  const component = nodeBy(schema, 'component');
  if (component) {
    return component.create({
      slug,
      description: entry?.description?.trim() ?? '',
      css: entry?.css ?? '',
      html: entry?.html ?? '',
    });
  }
  const para = nodeBy(schema, 'paragraph');
  if (!para) return null;
  return para.create(null, schema.text(`{${slug}}`));
}

export interface ComponentSubmenuEntry {
  slug: string;
  label: string;
  hint: string;
  description?: string;
  css?: string;
  html?: string;
}

// Filter / dedup the raw component list into the entries the popover
// submenu actually renders. Slugs that fail the loader's pattern are
// dropped (a typo wouldn't expand at render time, so showing them
// would be a dead-end click), and duplicate slugs collapse to the
// first occurrence — input order is otherwise preserved so the
// submenu mirrors whatever ordering the dashboard list view uses.
export function buildComponentSubmenuEntries(list: ComponentEntry[]): ComponentSubmenuEntry[] {
  const seen = new Set<string>();
  const entries: ComponentSubmenuEntry[] = [];
  for (const c of list) {
    if (!c.slug || seen.has(c.slug)) continue;
    if (!COMPONENT_SLUG_PATTERN.test(c.slug)) continue;
    seen.add(c.slug);
    entries.push({
      slug: c.slug,
      label: `{${c.slug}}`,
      hint: c.description?.trim() ?? '',
      description: c.description,
      css: c.css,
      html: c.html,
    });
  }
  return entries;
}

// Replace the empty paragraph at `target` with `inserted` and park the
// caret at the end of the inserted text. Pure transform — caller is
// responsible for `view.dispatch(tr.scrollIntoView())`. Split out from
// the plugin so tests can drive it directly without a DOM.
export function buildInsertComponentTransaction(
  state: EditorState,
  target: EmptyParagraphTarget,
  inserted: ProseNode,
): Transaction | null {
  const paraNode = state.doc.nodeAt(target.paraStart);
  if (!paraNode) return null;
  const paraEnd = target.paraStart + paraNode.nodeSize;
  let tr = state.tr.replaceWith(target.paraStart, paraEnd, inserted);
  if (inserted.isTextblock) {
    // Caret = paragraph open token (1) + text length. The inserted
    // paragraph wraps a single text node, so text length === nodeSize - 2
    // (open + close tokens).
    const caret = target.paraStart + 1 + (inserted.nodeSize - 2);
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
  } else {
    tr = tr.setSelection(NodeSelection.create(tr.doc, target.paraStart));
  }
  return tr;
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

export type ValidateBookmarkUrlResult = { ok: true; value: string } | { ok: false; error: string };

export function validateBookmarkUrl(raw: string): ValidateBookmarkUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Enter a URL' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid http(s) URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported' };
  }
  return { ok: true, value: url.toString() };
}
