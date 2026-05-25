// Ghost Koenig-style "+ insert" menu for the WYSIWYG editor.
//
// When the cursor sits on an empty top-level paragraph, a small `+`
// button floats in the left padding gutter of `.editorCanvas`
// (outside the writing column). Clicking it opens a popover with
// block-level insertions: Image (with upload), Divider, Code block,
// Table.
//
// Pure ProseMirror Plugin / View — no Preact inside this file so the
// editor critical path stays free of UI framework wiring. The image
// uploader is injected via plugin options so api.ts coupling is
// kept at the component layer.
//
// Position math: we anchor the `+` vertically to the caret line via
// `view.coordsAtPos(from)`, and horizontally to a fixed offset to
// the left of `view.dom`'s bounding box — that way the button always
// lives in the gutter no matter how the editor is laid out, and we
// don't have to walk the DOM up looking for `.editorCanvas`.

import type { NodeType, Node as ProseNode, Schema } from 'prosemirror-model';
import { type EditorState, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface InsertMenuUploadResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface InsertMenuOptions {
  // Optional image uploader. When provided, the Image menu item is
  // enabled and triggers a hidden file input → upload → insert flow.
  // Without it, the Image item is hidden (so themes / harnesses that
  // don't have an upload endpoint don't surface a broken button).
  uploadImage?: (file: File) => Promise<InsertMenuUploadResult>;
  // Default alt-text prompt is suppressed in tests; the option lets
  // the runtime customise the source filename → alt translation.
  altFromFilename?: (name: string) => string;
}

interface EmptyParagraphTarget {
  paraStart: number; // doc position of the paragraph's start token
  caretPos: number; // selection.from (same as $from.pos for an empty paragraph)
}

function altFromFilenameDefault(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return base.length > 0 ? base : 'image';
}

// True iff the cursor sits on an empty top-level paragraph (i.e.
// directly under the doc node). We restrict to depth=1 deliberately:
// empty paragraphs inside blockquotes / list items / table cells are
// natural targets for typing, not block-level insertion. The bubble
// menu already handles formatting inside those contexts.
function findEmptyParagraph(state: EditorState): EmptyParagraphTarget | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if ($from.parent.type.name !== 'paragraph') return null;
  if ($from.parent.content.size !== 0) return null;
  if ($from.depth !== 1) return null;
  return { paraStart: $from.before(), caretPos: selection.from };
}

function nodeBy(schema: Schema, name: string): NodeType | null {
  return schema.nodes[name] ?? null;
}

function build3x3Table(schema: Schema): ProseNode | null {
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

// Replace the empty paragraph that holds the caret with the given
// block-level node. We replace the *paragraph itself*, not insert
// alongside it, so the empty line vanishes — matching Ghost Koenig
// behaviour where the `+` consumes the empty line.
function replaceEmptyParagraph(
  view: EditorView,
  target: EmptyParagraphTarget,
  insertion: ProseNode,
): void {
  const paraNode = view.state.doc.nodeAt(target.paraStart);
  if (!paraNode) return;
  const paraEnd = target.paraStart + paraNode.nodeSize;
  const tr = view.state.tr.replaceWith(target.paraStart, paraEnd, insertion);
  view.dispatch(tr.scrollIntoView());
}

// Inline image insertion — basic-schema image is inline, so we keep
// the surrounding paragraph and just drop the image at the caret.
// This preserves Markdown round-trip (`![alt](src)`).
function insertImageInline(
  view: EditorView,
  schema: Schema,
  attrs: { src: string; alt: string },
): void {
  const image = nodeBy(schema, 'image');
  if (!image) return;
  const node = image.create(attrs);
  const tr = view.state.tr.replaceSelectionWith(node, false).scrollIntoView();
  view.dispatch(tr);
}

interface MenuItemSpec {
  key: string;
  label: string;
  hint: string;
  // Returns true if the item is currently available. Items return
  // false → hidden in the popover (we don't grey-out to keep the
  // surface clean).
  enabled: (schema: Schema, options: InsertMenuOptions) => boolean;
  run: (
    view: EditorView,
    schema: Schema,
    target: EmptyParagraphTarget,
    options: InsertMenuOptions,
    ui: { fileInput: HTMLInputElement; close: () => void },
  ) => void;
}

const MENU_ITEMS: MenuItemSpec[] = [
  {
    key: 'image',
    label: 'Image',
    hint: 'Upload an image from your computer',
    enabled: (schema, options) => Boolean(options.uploadImage) && Boolean(nodeBy(schema, 'image')),
    run(_view, _schema, _target, _options, ui) {
      ui.fileInput.value = '';
      ui.fileInput.click();
      ui.close();
    },
  },
  {
    key: 'divider',
    label: 'Divider',
    hint: 'Horizontal rule between sections',
    enabled: (schema) => Boolean(nodeBy(schema, 'horizontal_rule')),
    run(view, schema, target, _options, ui) {
      const hr = nodeBy(schema, 'horizontal_rule');
      if (!hr) return;
      replaceEmptyParagraph(view, target, hr.create());
      ui.close();
      view.focus();
    },
  },
  {
    key: 'code-block',
    label: 'Code block',
    hint: 'Fenced code with monospaced font',
    enabled: (schema) => Boolean(nodeBy(schema, 'code_block')),
    run(view, schema, target, _options, ui) {
      const code = nodeBy(schema, 'code_block');
      if (!code) return;
      const filled = code.createAndFill();
      if (!filled) return;
      replaceEmptyParagraph(view, target, filled);
      ui.close();
      view.focus();
    },
  },
  {
    key: 'table',
    label: 'Table',
    hint: 'Insert a 3×3 table',
    enabled: (schema) => Boolean(nodeBy(schema, 'table')),
    run(view, schema, target, _options, ui) {
      const table = build3x3Table(schema);
      if (!table) return;
      replaceEmptyParagraph(view, target, table);
      ui.close();
      view.focus();
    },
  },
];

export function insertMenuPlugin(schema: Schema, options: InsertMenuOptions = {}): Plugin {
  const opts: Required<Pick<InsertMenuOptions, 'altFromFilename'>> & InsertMenuOptions = {
    altFromFilename: options.altFromFilename ?? altFromFilenameDefault,
    uploadImage: options.uploadImage,
  };

  return new Plugin({
    view(view) {
      // ---- DOM nodes -------------------------------------------------
      const root = document.createElement('div');
      root.className = 'proseInsertMenu';
      root.style.position = 'fixed';
      root.style.visibility = 'hidden';
      root.style.pointerEvents = 'none';
      view.dom.parentElement?.appendChild(root);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'proseInsertTrigger';
      trigger.setAttribute('aria-label', 'Insert block');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.textContent = '+';
      root.appendChild(trigger);

      const popover = document.createElement('div');
      popover.className = 'proseInsertPopover';
      popover.setAttribute('role', 'menu');
      popover.hidden = true;
      root.appendChild(popover);

      const itemButtons: HTMLButtonElement[] = [];
      for (const item of MENU_ITEMS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'proseInsertItem';
        btn.dataset.key = item.key;
        btn.setAttribute('role', 'menuitem');
        const label = document.createElement('span');
        label.className = 'proseInsertItemLabel';
        label.textContent = item.label;
        const hint = document.createElement('span');
        hint.className = 'proseInsertItemHint';
        hint.textContent = item.hint;
        btn.appendChild(label);
        btn.appendChild(hint);
        popover.appendChild(btn);
        itemButtons.push(btn);
      }

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.className = 'proseInsertFileInput';
      fileInput.hidden = true;
      root.appendChild(fileInput);

      let currentTarget: EmptyParagraphTarget | null = null;
      let popoverOpen = false;

      function openPopover(): void {
        if (popoverOpen) return;
        popoverOpen = true;
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        trigger.dataset.open = 'true';
      }

      function closePopover(): void {
        if (!popoverOpen) return;
        popoverOpen = false;
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.dataset.open = 'false';
      }

      async function runUpload(file: File): Promise<void> {
        const uploader = opts.uploadImage;
        if (!uploader) return;
        const target = currentTarget;
        if (!target) return;
        const result = await uploader(file);
        if (!result.ok || !result.path) {
          // Surface upload errors via the trigger title — the
          // dashboard's notice strip is the more user-visible
          // channel, but we don't have access to it here. Console
          // is fine as a fallback for now.
          // eslint-disable-next-line no-console
          console.error('insert-menu: image upload failed', result.error);
          return;
        }
        // The doc may have changed while the upload was in flight.
        // Re-resolve a sensible insertion point: if the user is still
        // sitting on the same empty paragraph, insert inline there;
        // otherwise just append to the current selection.
        const fresh = findEmptyParagraph(view.state);
        const alt = opts.altFromFilename(file.name);
        if (fresh && fresh.paraStart === target.paraStart) {
          insertImageInline(view, schema, { src: result.path, alt });
        } else {
          insertImageInline(view, schema, { src: result.path, alt });
        }
        view.focus();
      }

      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        void runUpload(f);
      });

      trigger.addEventListener('mousedown', (event) => {
        event.preventDefault(); // don't steal focus from the editor
      });
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        if (popoverOpen) {
          closePopover();
        } else {
          openPopover();
        }
      });

      for (let i = 0; i < itemButtons.length; i += 1) {
        const btn = itemButtons[i];
        const item = MENU_ITEMS[i];
        if (!btn || !item) continue;
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const target = currentTarget;
          if (!target) {
            closePopover();
            return;
          }
          item.run(view, schema, target, opts, { fileInput, close: closePopover });
        });
      }

      function onDocumentMousedown(event: MouseEvent) {
        if (!popoverOpen) return;
        const t = event.target;
        if (t instanceof Node && root.contains(t)) return;
        closePopover();
      }
      document.addEventListener('mousedown', onDocumentMousedown);

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape' && popoverOpen) {
          event.stopPropagation();
          closePopover();
          view.focus();
        }
      }
      document.addEventListener('keydown', onKeyDown, true);

      function update(currentView: EditorView): void {
        const target = findEmptyParagraph(currentView.state);
        const focused = currentView.hasFocus() || popoverOpen;
        if (!target || !focused) {
          root.style.visibility = 'hidden';
          root.style.pointerEvents = 'none';
          currentTarget = null;
          if (popoverOpen) closePopover();
          return;
        }
        currentTarget = target;

        // Apply per-item enabled state. Items disabled by missing
        // schema nodes or absent uploader get hidden — we don't grey
        // them out to keep the surface unambiguous.
        for (let i = 0; i < MENU_ITEMS.length; i += 1) {
          const item = MENU_ITEMS[i];
          const btn = itemButtons[i];
          if (!item || !btn) continue;
          btn.hidden = !item.enabled(schema, opts);
        }

        // Anchor: line top of the empty paragraph + horizontal offset
        // from `view.dom`'s left edge, pushed into the gutter.
        const coords = currentView.coordsAtPos(target.caretPos, 1);
        const lineHeight = Math.max(coords.bottom - coords.top, 18);
        const proseRect = currentView.dom.getBoundingClientRect();
        const buttonSize = 28;
        const gutterGap = 12;
        let left = proseRect.left - buttonSize - gutterGap;
        // If the available gutter is too narrow (e.g. mobile where
        // `.editorCanvas` collapses), tuck the button just inside
        // the prose column at the left edge. The visual cost is
        // small; without this the button would fall off-screen.
        if (left < 8) {
          left = Math.max(8, proseRect.left + 4);
        }
        const top = coords.top + (lineHeight - buttonSize) / 2;
        root.style.visibility = 'visible';
        root.style.pointerEvents = 'auto';
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
      }

      update(view);
      return {
        update(currentView) {
          update(currentView);
        },
        destroy() {
          document.removeEventListener('mousedown', onDocumentMousedown);
          document.removeEventListener('keydown', onKeyDown, true);
          root.remove();
        },
      };
    },
  });
}

// Exported for tests — predicate logic without the DOM surface.
export const _internal = { findEmptyParagraph, build3x3Table, altFromFilenameDefault };
