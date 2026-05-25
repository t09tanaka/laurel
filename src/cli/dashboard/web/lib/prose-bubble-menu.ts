// Selection-anchored bubble menu for the ProseMirror surface.
//
// Renders a small floating row of mark / link controls just above the
// current text selection. Pure ProseMirror Plugin / View — no Preact
// inside this file so we don't pull preact into the editor critical
// path.
//
// Two notable edge cases the user asked for:
// 1. When the cursor is *inside* an inline mark (code / link / bold
//    / italic) without a range selection, the bubble still shows so
//    the mark can be cleared with one click.
// 2. Link editing happens inline inside the bubble — clicking Link
//    swaps the row for a URL input + Apply / Remove / Cancel, no
//    window.prompt().

import { setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { type Mark, type MarkType, type NodeType, type ResolvedPos, type Schema } from 'prosemirror-model';
import { wrapInList } from 'prosemirror-schema-list';
import { Plugin, type EditorState } from 'prosemirror-state';
import { type EditorView } from 'prosemirror-view';

function activeBlockType(state: EditorState): { name: string; attrs: Record<string, unknown> } {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) return { name: node.type.name, attrs: { ...node.attrs } };
    if (node.type.name === 'blockquote') return { name: 'blockquote', attrs: {} };
  }
  return { name: 'paragraph', attrs: {} };
}

function blockMatches(
  state: EditorState,
  name: string,
  attrs: Record<string, unknown> = {},
): boolean {
  const current = activeBlockType(state);
  if (current.name !== name) return false;
  for (const key of Object.keys(attrs)) {
    if (current.attrs[key] !== attrs[key]) return false;
  }
  return true;
}

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

function markRangeAround(
  $pos: ResolvedPos,
  mark: Mark,
): { from: number; to: number } | null {
  const parent = $pos.parent;
  const parentStart = $pos.start();
  // Locate the child that contains the cursor offset.
  let walked = 0;
  let childIndex = -1;
  let childStart = 0;
  for (let i = 0; i < parent.childCount; i += 1) {
    const child = parent.child(i);
    const next = walked + child.nodeSize;
    if ($pos.parentOffset >= walked && $pos.parentOffset <= next) {
      childIndex = i;
      childStart = walked;
      break;
    }
    walked = next;
  }
  if (childIndex < 0) return null;
  const child = parent.child(childIndex);
  if (!mark.isInSet(child.marks)) return null;
  let leftOffset = childStart;
  let rightOffset = childStart + child.nodeSize;
  // Walk left while previous sibling carries the same mark instance.
  for (let i = childIndex - 1; i >= 0; i -= 1) {
    const sib = parent.child(i);
    if (!mark.isInSet(sib.marks)) break;
    leftOffset -= sib.nodeSize;
  }
  for (let i = childIndex + 1; i < parent.childCount; i += 1) {
    const sib = parent.child(i);
    if (!mark.isInSet(sib.marks)) break;
    rightOffset += sib.nodeSize;
  }
  if (leftOffset === rightOffset) return null;
  return { from: parentStart + leftOffset, to: parentStart + rightOffset };
}

function anyMarksHere(state: EditorState): boolean {
  const { empty, $from, from, to } = state.selection;
  if (empty) {
    return ($from.marks().length ?? 0) > 0 || (state.storedMarks?.length ?? 0) > 0;
  }
  for (const markName of Object.keys(state.schema.marks)) {
    const type = state.schema.marks[markName];
    if (type && state.doc.rangeHasMark(from, to, type)) return true;
  }
  return false;
}

function rangeForMark(
  state: EditorState,
  type: MarkType,
): { from: number; to: number } | null {
  const { selection } = state;
  if (!selection.empty) return { from: selection.from, to: selection.to };
  const $from = selection.$from;
  const mark = type.isInSet($from.marks());
  if (!mark) return null;
  return markRangeAround($from, mark);
}

function currentLinkHref(state: EditorState, linkType: MarkType): string | null {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const mark = $from.marks().find((m) => m.type === linkType);
    return mark ? String(mark.attrs.href ?? '') : null;
  }
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (href) return false;
    const mark = node.marks.find((m) => m.type === linkType);
    if (mark) href = String(mark.attrs.href ?? '');
    return true;
  });
  return href;
}

type BubbleScope = 'always' | 'range';

interface BubbleButton {
  label: string;
  title: string;
  mark?: string;
  /** When this button is meaningful. 'range' = only with a non-empty
   * selection. 'always' = also when the cursor sits inside an
   * existing inline mark. */
  scope?: BubbleScope;
  run?: (view: EditorView, ctx: { openLinkEditor: () => void }) => void;
  active?: (state: EditorState) => boolean;
}

export function bubbleMenuPlugin(schema: Schema): Plugin {
  return new Plugin({
    view(view) {
      const root = document.createElement('div');
      root.className = 'proseBubble';
      root.setAttribute('role', 'toolbar');
      root.setAttribute('aria-label', 'Selection formatting');
      root.style.position = 'absolute';
      root.style.visibility = 'hidden';
      root.style.pointerEvents = 'none';
      view.dom.parentElement?.appendChild(root);

      const linkType = schema.marks.link;

      // ---- Marks row (default) ------------------------------------
      const marksRow = document.createElement('div');
      marksRow.className = 'proseBubbleRow proseBubbleRow--marks';
      root.appendChild(marksRow);

      // ---- Link editor row -----------------------------------------
      const linkRow = document.createElement('div');
      linkRow.className = 'proseBubbleRow proseBubbleRow--link';
      linkRow.hidden = true;
      const linkInput = document.createElement('input');
      linkInput.type = 'url';
      linkInput.placeholder = 'https://';
      linkInput.className = 'proseBubbleInput';
      linkRow.appendChild(linkInput);
      const linkApply = document.createElement('button');
      linkApply.type = 'button';
      linkApply.className = 'proseBubbleBtn';
      linkApply.textContent = 'Apply';
      linkRow.appendChild(linkApply);
      const linkRemove = document.createElement('button');
      linkRemove.type = 'button';
      linkRemove.className = 'proseBubbleBtn';
      linkRemove.textContent = 'Remove';
      linkRow.appendChild(linkRemove);
      const linkCancel = document.createElement('button');
      linkCancel.type = 'button';
      linkCancel.className = 'proseBubbleBtn';
      linkCancel.textContent = 'Cancel';
      linkRow.appendChild(linkCancel);
      root.appendChild(linkRow);

      let mode: 'marks' | 'link' = 'marks';

      function openLinkEditor() {
        if (!linkType) return;
        mode = 'link';
        marksRow.hidden = true;
        linkRow.hidden = false;
        linkInput.value = currentLinkHref(view.state, linkType) ?? '';
        // Defer focus so the click that opened us doesn't immediately
        // steal focus back.
        setTimeout(() => linkInput.focus(), 0);
        linkInput.select();
        // Show / hide Remove based on whether the cursor is in a link.
        linkRemove.hidden = !currentLinkHref(view.state, linkType);
      }

      function closeLinkEditor() {
        mode = 'marks';
        marksRow.hidden = false;
        linkRow.hidden = true;
        view.focus();
      }

      function applyLinkFromInput() {
        if (!linkType) return;
        const trimmed = linkInput.value.trim();
        if (!trimmed) {
          closeLinkEditor();
          return;
        }
        const { from, to, empty } = view.state.selection;
        if (empty) {
          // Cursor inside an existing link → update its run.
          const range = rangeForMark(view.state, linkType);
          if (range) {
            const tr = view.state.tr
              .removeMark(range.from, range.to, linkType)
              .addMark(range.from, range.to, linkType.create({ href: trimmed }));
            view.dispatch(tr);
          }
        } else {
          view.dispatch(view.state.tr.addMark(from, to, linkType.create({ href: trimmed })));
        }
        closeLinkEditor();
      }

      function removeCurrentLink() {
        if (!linkType) return;
        const range = rangeForMark(view.state, linkType);
        if (range) {
          view.dispatch(view.state.tr.removeMark(range.from, range.to, linkType));
        }
        closeLinkEditor();
      }

      linkInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyLinkFromInput();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeLinkEditor();
        }
      });
      linkApply.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applyLinkFromInput();
      });
      linkRemove.addEventListener('mousedown', (event) => {
        event.preventDefault();
        removeCurrentLink();
      });
      linkCancel.addEventListener('mousedown', (event) => {
        event.preventDefault();
        closeLinkEditor();
      });

      const nodeBy = (name: string): NodeType | undefined => schema.nodes[name];
      const setHeading = (level: number) => (v: EditorView) => {
        const h = nodeBy('heading');
        const p = nodeBy('paragraph');
        if (!h || !p) return;
        if (blockMatches(v.state, 'heading', { level })) {
          setBlockType(p)(v.state, v.dispatch);
        } else {
          setBlockType(h, { level })(v.state, v.dispatch);
        }
        v.focus();
      };
      const setParagraph = (v: EditorView) => {
        const p = nodeBy('paragraph');
        if (!p) return;
        setBlockType(p)(v.state, v.dispatch);
        v.focus();
      };
      const toggleQuote = (v: EditorView) => {
        const bq = nodeBy('blockquote');
        const p = nodeBy('paragraph');
        if (!bq || !p) return;
        if (blockMatches(v.state, 'blockquote')) {
          // Lift out of blockquote by clearing block to paragraph.
          setBlockType(p)(v.state, v.dispatch);
        } else {
          wrapIn(bq)(v.state, v.dispatch);
        }
        v.focus();
      };
      const toggleBulletList = (v: EditorView) => {
        const bl = nodeBy('bullet_list');
        if (!bl) return;
        wrapInList(bl)(v.state, v.dispatch);
        v.focus();
      };
      const toggleOrderedList = (v: EditorView) => {
        const ol = nodeBy('ordered_list');
        if (!ol) return;
        wrapInList(ol)(v.state, v.dispatch);
        v.focus();
      };
      const toggleCodeBlock = (v: EditorView) => {
        const cb = nodeBy('code_block');
        const p = nodeBy('paragraph');
        if (!cb || !p) return;
        if (blockMatches(v.state, 'code_block')) {
          setBlockType(p)(v.state, v.dispatch);
        } else {
          setBlockType(cb)(v.state, v.dispatch);
        }
        v.focus();
      };
      const insertHr = (v: EditorView) => {
        const hr = nodeBy('horizontal_rule');
        if (!hr) return;
        v.dispatch(v.state.tr.replaceSelectionWith(hr.create()).scrollIntoView());
        v.focus();
      };

      const buttons: BubbleButton[] = [
        { label: 'B', title: 'Bold (⌘B) — click again to clear', mark: 'strong', scope: 'always' },
        { label: 'I', title: 'Italic (⌘I) — click again to clear', mark: 'em', scope: 'always' },
        { label: 'S', title: 'Strikethrough (⌘⇧S)', mark: 'strikethrough', scope: 'always' },
        { label: '<>', title: 'Inline code (⌘`) — click again to clear', mark: 'code', scope: 'always' },
        {
          label: 'Link',
          title: 'Toggle / edit link',
          scope: 'always',
          run(_v, ctx) {
            ctx.openLinkEditor();
          },
          active(state) {
            return linkType ? isMarkActive(state, linkType) : false;
          },
        },
        {
          label: 'H1',
          title: 'Heading 1',
          scope: 'range',
          run: setHeading(1),
          active: (s) => blockMatches(s, 'heading', { level: 1 }),
        },
        {
          label: 'H2',
          title: 'Heading 2',
          scope: 'range',
          run: setHeading(2),
          active: (s) => blockMatches(s, 'heading', { level: 2 }),
        },
        {
          label: 'H3',
          title: 'Heading 3',
          scope: 'range',
          run: setHeading(3),
          active: (s) => blockMatches(s, 'heading', { level: 3 }),
        },
        {
          label: 'P',
          title: 'Paragraph',
          scope: 'range',
          run: setParagraph,
          active: (s) => blockMatches(s, 'paragraph'),
        },
        {
          label: '"',
          title: 'Quote',
          scope: 'range',
          run: toggleQuote,
          active: (s) => blockMatches(s, 'blockquote'),
        },
        {
          label: '•',
          title: 'Bulleted list',
          scope: 'range',
          run: toggleBulletList,
        },
        {
          label: '1.',
          title: 'Numbered list',
          scope: 'range',
          run: toggleOrderedList,
        },
        {
          label: '{}',
          title: 'Code block',
          scope: 'range',
          run: toggleCodeBlock,
          active: (s) => blockMatches(s, 'code_block'),
        },
        {
          label: '—',
          title: 'Insert divider',
          scope: 'range',
          run: insertHr,
        },
        {
          label: 'Clear',
          title: 'Remove formatting at the cursor or selection',
          scope: 'always',
          run(v) {
            const state = v.state;
            const { empty, $from, from, to } = state.selection;
            let tr = state.tr;
            let mutated = false;
            if (empty) {
              for (const m of $from.marks()) {
                const range = markRangeAround($from, m);
                if (range) {
                  tr = tr.removeMark(range.from, range.to, m.type);
                  mutated = true;
                }
              }
            } else {
              for (const markName of Object.keys(state.schema.marks)) {
                const type = state.schema.marks[markName];
                if (!type) continue;
                if (!state.doc.rangeHasMark(from, to, type)) continue;
                tr = tr.removeMark(from, to, type);
                mutated = true;
              }
            }
            if (mutated) v.dispatch(tr);
            v.focus();
          },
        },
      ];

      const btns: HTMLButtonElement[] = [];
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.title = b.title;
        btn.className = 'proseBubbleBtn';
        btn.dataset.mark = b.mark ?? '';
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
          if (b.run) {
            b.run(view, { openLinkEditor });
            return;
          }
          if (!b.mark) return;
          const type = schema.marks[b.mark];
          if (!type) return;
          const range = rangeForMark(view.state, type);
          if (range && view.state.selection.empty) {
            view.dispatch(view.state.tr.removeMark(range.from, range.to, type));
            view.focus();
            return;
          }
          toggleMark(type)(view.state, view.dispatch);
          view.focus();
        });
        marksRow.appendChild(btn);
        btns.push(btn);
      }

      function update(currentView: EditorView): void {
        const state = currentView.state;
        const { from, to, empty } = state.selection;
        const focused = currentView.hasFocus() || mode === 'link';
        const shouldShow = focused && (!empty || anyMarksHere(state) || mode === 'link');
        if (!shouldShow) {
          root.style.visibility = 'hidden';
          root.style.pointerEvents = 'none';
          if (mode === 'link') closeLinkEditor();
          return;
        }
        const parent = root.offsetParent as HTMLElement | null;
        const parentRect = parent
          ? parent.getBoundingClientRect()
          : { left: 0, top: 0, width: window.innerWidth };
        // For an empty selection the browser's own caret rect tracks
        // text wrapping accurately; coordsAtPos can return the prior
        // line's edge when the caret sits at a wrap boundary.
        let anchorCenter = 0;
        let anchorTop = 0;
        if (empty) {
          const sel = window.getSelection();
          let caretRect: DOMRect | null = null;
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0).cloneRange();
            range.collapse(true);
            const rects = range.getClientRects();
            caretRect =
              rects.length > 0 ? rects[rects.length - 1] ?? null : range.getBoundingClientRect();
          }
          if (!caretRect || (caretRect.left === 0 && caretRect.top === 0)) {
            const fallback = currentView.coordsAtPos(from);
            caretRect = new DOMRect(fallback.left, fallback.top, 0, fallback.bottom - fallback.top);
          }
          anchorCenter = caretRect.left + caretRect.width / 2 - parentRect.left;
          anchorTop = caretRect.top - parentRect.top;
        } else {
          const start = currentView.coordsAtPos(from);
          const end = currentView.coordsAtPos(to);
          anchorCenter = (start.left + end.left) / 2 - parentRect.left;
          anchorTop = start.top - parentRect.top;
        }
        // Render then measure so we can clamp into the parent's bounds.
        root.style.visibility = 'visible';
        root.style.pointerEvents = 'auto';
        root.style.transform = 'translate(0, calc(-100% - 10px))';
        const bubbleRect = root.getBoundingClientRect();
        const half = bubbleRect.width / 2;
        const minLeft = 8;
        const maxLeft = Math.max(minLeft, parentRect.width - bubbleRect.width - 8);
        const left = Math.min(Math.max(anchorCenter - half, minLeft), maxLeft);
        root.style.left = `${left}px`;
        root.style.top = `${anchorTop}px`;
        const hasRange = !empty;
        for (let i = 0; i < buttons.length; i += 1) {
          const b = buttons[i];
          const btn = btns[i];
          if (!b || !btn) continue;
          const visible = b.scope === 'range' ? hasRange : true;
          btn.hidden = !visible;
          if (!visible) {
            btn.dataset.active = 'false';
            continue;
          }
          let active = false;
          if (b.active) active = b.active(state);
          else if (b.mark) {
            const type = schema.marks[b.mark];
            if (type) active = isMarkActive(state, type);
          }
          btn.dataset.active = active ? 'true' : 'false';
        }
      }

      update(view);
      return {
        update(currentView) {
          update(currentView);
        },
        destroy() {
          root.remove();
        },
      };
    },
  });
}
