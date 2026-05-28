// Callout NodeView: renders a Ghost-compatible `<div class="kg-callout-card">`
// whose `.kg-callout-text` is the editable body (contentDOM), wrapped in the
// shared theme scope so the active theme's `.kg-callout-card-*` rules paint the
// card exactly as the published site would. The emoji picker, colour palette,
// icon toggle and remove control are dashboard chrome layered on top and live
// outside the Ghost-class DOM so theme CSS does not style them.

import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import {
  CALLOUT_COLORS,
  type CalloutAttrs,
  type CalloutColor,
  DEFAULT_CALLOUT_EMOJI,
  clampCalloutColor,
} from './prose-callout-schema.ts';
import { EmojiPicker } from './prose-emoji-picker.ts';

// The active theme's CSS is served rescoped under this class (see
// src/cli/dashboard/theme-css-rewriter.ts), so reusing it gives the callout
// card the same in-editor paint parity that the bookmark card relies on.
const THEME_SCOPE_CLASS = 'proseBookmarkScope';

export class CalloutNodeView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly cardEl: HTMLElement;
  private readonly emojiEl: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly emojiButton: HTMLButtonElement;
  private readonly swatches: Map<CalloutColor, HTMLButtonElement> = new Map();
  private readonly iconToggle: HTMLButtonElement;
  private readonly picker: EmojiPicker;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const wrapper = document.createElement('div');
    wrapper.className = 'proseCallout';
    this.dom = wrapper;

    // Only the card sits inside the theme scope. The toolbar (appended to the
    // wrapper, outside this element) must stay out of it, otherwise the theme's
    // rescoped `button` / `*` resets clobber the colour swatches and controls.
    const scope = document.createElement('div');
    scope.className = THEME_SCOPE_CLASS;
    wrapper.appendChild(scope);

    this.cardEl = document.createElement('div');
    scope.appendChild(this.cardEl);

    this.emojiEl = document.createElement('div');
    this.emojiEl.className = 'kg-callout-emoji';
    this.emojiEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.emojiEl.addEventListener('click', (e) => {
      e.preventDefault();
      this.openPicker(this.emojiEl);
    });
    this.cardEl.appendChild(this.emojiEl);

    // The editable body. ProseMirror owns its children — update() never
    // rebuilds this element.
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'kg-callout-text';
    this.cardEl.appendChild(this.contentDOM);

    // Visibility is CSS-driven (hover or node selection) so the controls are
    // reachable while editing the body, not only on NodeSelection.
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'proseCalloutToolbar';

    this.emojiButton = document.createElement('button');
    this.emojiButton.type = 'button';
    this.emojiButton.className = 'proseCalloutToolBtn proseCalloutEmojiBtn';
    this.emojiButton.title = 'Choose icon';
    this.emojiButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.emojiButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.openPicker(this.emojiButton);
    });
    this.toolbar.appendChild(this.emojiButton);

    const palette = document.createElement('div');
    palette.className = 'proseCalloutPalette';
    for (const color of CALLOUT_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = `proseCalloutSwatch proseCalloutSwatch--${color}`;
      swatch.title = color;
      swatch.dataset.color = color;
      swatch.addEventListener('mousedown', (e) => e.preventDefault());
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        this.setAttrs({ color });
      });
      palette.appendChild(swatch);
      this.swatches.set(color, swatch);
    }
    this.toolbar.appendChild(palette);

    this.iconToggle = document.createElement('button');
    this.iconToggle.type = 'button';
    this.iconToggle.className = 'proseCalloutToolBtn';
    this.iconToggle.addEventListener('mousedown', (e) => e.preventDefault());
    this.iconToggle.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleIcon();
    });
    this.toolbar.appendChild(this.iconToggle);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'proseCalloutToolBtn proseCalloutRemove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      this.view.dispatch(tr);
      this.view.focus();
    });
    this.toolbar.appendChild(removeBtn);

    wrapper.appendChild(this.toolbar);

    this.picker = new EmojiPicker({
      onSelect: (emoji) => {
        // Picking a unicode emoji supersedes any custom emoji-html slot.
        const prev = this.attrs().extra ?? {};
        const extra: Record<string, string> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (key !== 'emoji-html') extra[key] = value;
        }
        this.setAttrs({ emoji, noIcon: false, extra });
        this.view.focus();
      },
    });

    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('proseCallout--selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('proseCallout--selected');
    this.picker.close();
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target instanceof Node && this.contentDOM.contains(target)) return false;
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: string; target: Node }): boolean {
    if (mutation.type === 'selection') {
      return !this.contentDOM.contains(mutation.target);
    }
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.picker.destroy();
  }

  private attrs(): CalloutAttrs {
    return this.node.attrs as CalloutAttrs;
  }

  private setAttrs(patch: Partial<CalloutAttrs>): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch });
    this.view.dispatch(tr);
  }

  private toggleIcon(): void {
    const attrs = this.attrs();
    if (attrs.noIcon) {
      const emoji = attrs.emoji || DEFAULT_CALLOUT_EMOJI;
      this.setAttrs({ noIcon: false, emoji });
    } else {
      this.setAttrs({ noIcon: true });
    }
  }

  private openPicker(anchor: HTMLElement): void {
    if (this.picker.isOpen) {
      this.picker.close();
      return;
    }
    this.picker.open(anchor);
  }

  private render(): void {
    const attrs = this.attrs();
    const color = clampCalloutColor(String(attrs.color ?? ''));
    const noIcon = attrs.noIcon === true;

    const classes = ['kg-card', 'kg-callout-card', `kg-callout-card-${color}`];
    if (noIcon) classes.push('kg-callout-card-without-emoji');
    this.cardEl.className = classes.join(' ');

    const emojiHtml = attrs.extra?.['emoji-html'];
    if (noIcon) {
      this.emojiEl.hidden = true;
    } else {
      this.emojiEl.hidden = false;
      if (typeof emojiHtml === 'string' && emojiHtml !== '') {
        // Author-trusted custom icon markup, same trust level as component
        // snippet HTML rendered elsewhere in the editor.
        this.emojiEl.innerHTML = emojiHtml;
      } else {
        this.emojiEl.textContent = attrs.emoji || DEFAULT_CALLOUT_EMOJI;
      }
    }

    this.emojiButton.textContent = noIcon ? '🚫' : attrs.emoji || DEFAULT_CALLOUT_EMOJI;
    this.iconToggle.textContent = noIcon ? 'Show icon' : 'Hide icon';

    for (const [swatchColor, swatch] of this.swatches) {
      swatch.classList.toggle('proseCalloutSwatch--active', swatchColor === color);
    }
  }
}
