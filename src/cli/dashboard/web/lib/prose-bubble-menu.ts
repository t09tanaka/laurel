// Selection-anchored bubble menu for the ProseMirror surface.
//
// Renders a small floating row of mark / link controls just above the
// current text selection. Pure ProseMirror Plugin / View — no Preact
// inside this file so we don't pull preact into the editor critical
// path. The DOM is created once per editor view and reused.

import { toggleMark } from 'prosemirror-commands';
import type { MarkType, Schema } from 'prosemirror-model';
import { Plugin, type EditorState } from 'prosemirror-state';
import { type EditorView } from 'prosemirror-view';

function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

function selectionLink(state: EditorState, linkType: MarkType): string | null {
  const { from, to } = state.selection;
  let href: string | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    const mark = node.marks.find((m) => m.type === linkType);
    if (mark && typeof mark.attrs.href === 'string') {
      href = mark.attrs.href;
      return false;
    }
    return true;
  });
  return href;
}

interface BubbleButton {
  label: string;
  title: string;
  mark?: string;
  /** Toggle a mark on the current selection. */
  run?: (view: EditorView) => void;
  /** Whether this button reads as "active" for the current state. */
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
      const buttons: BubbleButton[] = [
        {
          label: 'B',
          title: 'Bold (⌘B)',
          mark: 'strong',
        },
        {
          label: 'I',
          title: 'Italic (⌘I)',
          mark: 'em',
        },
        {
          label: '<>',
          title: 'Inline code (⌘`)',
          mark: 'code',
        },
        {
          label: 'Link',
          title: 'Toggle link',
          run(v) {
            if (!linkType) return;
            const existing = selectionLink(v.state, linkType);
            if (existing) {
              // Drop the link mark from the selection.
              const { from, to } = v.state.selection;
              v.dispatch(v.state.tr.removeMark(from, to, linkType));
              v.focus();
              return;
            }
            const href = window.prompt('Link URL', 'https://');
            if (!href) return;
            const trimmed = href.trim();
            if (!trimmed) return;
            const { from, to } = v.state.selection;
            v.dispatch(
              v.state.tr.addMark(from, to, linkType.create({ href: trimmed })),
            );
            v.focus();
          },
          active(state) {
            return linkType ? isMarkActive(state, linkType) : false;
          },
        },
        {
          label: 'Clear',
          title: 'Remove all marks from the selection',
          run(v) {
            const { from, to } = v.state.selection;
            if (from === to) return;
            let tr = v.state.tr;
            for (const markName of Object.keys(schema.marks)) {
              const type = schema.marks[markName];
              if (!type) continue;
              tr = tr.removeMark(from, to, type);
            }
            v.dispatch(tr);
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
            b.run(view);
            return;
          }
          if (b.mark) {
            const type = schema.marks[b.mark];
            if (!type) return;
            toggleMark(type)(view.state, view.dispatch);
            view.focus();
          }
        });
        root.appendChild(btn);
        btns.push(btn);
      }

      function update(currentView: EditorView): void {
        const state = currentView.state;
        const { from, to, empty } = state.selection;
        if (empty || !currentView.hasFocus()) {
          root.style.visibility = 'hidden';
          root.style.pointerEvents = 'none';
          return;
        }
        // Don't show inside tables — table editing has its own
        // affordances (Tab navigation, cell selection).
        const $from = state.selection.$from;
        for (let d = $from.depth; d > 0; d -= 1) {
          if ($from.node(d).type.name === 'table_cell' || $from.node(d).type.name === 'table_header') {
            // still show for inline marks inside a cell — actually keep menu.
            break;
          }
        }
        const start = currentView.coordsAtPos(from);
        const end = currentView.coordsAtPos(to);
        const parent = root.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
        const left = (start.left + end.left) / 2 - parentRect.left;
        const top = start.top - parentRect.top;
        root.style.visibility = 'visible';
        root.style.pointerEvents = 'auto';
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.transform = 'translate(-50%, calc(-100% - 10px))';
        for (let i = 0; i < buttons.length; i += 1) {
          const b = buttons[i];
          const btn = btns[i];
          if (!b || !btn) continue;
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
