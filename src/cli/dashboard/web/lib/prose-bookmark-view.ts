// Bookmark NodeView that renders a Ghost-compatible card DOM
// (`<figure class="kg-card kg-bookmark-card">…<figcaption>`) wrapped in
// `<div class="proseBookmarkScope">`. The dashboard loads the active
// theme's `assets/built/screen.css` with all its selectors rescoped to
// `.proseBookmarkScope` (see `src/cli/dashboard/theme-css-rewriter.ts`),
// so the card paints itself with the same CSS the published site would
// use. Replace / Remove controls and the caption editor are
// dashboard-specific UI layered on top — they stay outside the
// Ghost-class DOM so theme CSS does not style them.

import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export interface BookmarkNodeViewOptions {
  // Called when the user clicks "Replace". The runtime should open the
  // insert-menu URL input view anchored to this node; we keep the
  // coupling shallow by exposing a single callback.
  onReplace?: (pos: number, node: ProseNode) => void;
}

export class BookmarkNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly options: BookmarkNodeViewOptions;
  private readonly cardSlot: HTMLElement;
  private readonly figcaptionEl: HTMLElement;
  private readonly captionInput: HTMLInputElement;
  private readonly actions: HTMLElement;
  private readonly figureEl: HTMLElement;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: BookmarkNodeViewOptions = {},
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;

    // Outer wrapper applies the theme scope. Theme CSS variables (font,
    // colors) defined via :root rules in the source resolve inside this
    // wrapper, so the kg-bookmark-card tree below inherits them.
    const wrapper = document.createElement('div');
    wrapper.className = 'proseBookmarkScope proseBookmarkFigure';
    this.dom = wrapper;

    // The card itself is a Ghost-shape `<figure>`. We keep a reference
    // because update() rebuilds its inner subtree (title/desc/...) but
    // not the figure element.
    this.figureEl = document.createElement('figure');
    this.figureEl.className = 'kg-card kg-bookmark-card';
    wrapper.appendChild(this.figureEl);

    // Slot for the inner `<a class="kg-bookmark-container">` — replaced
    // wholesale on each render to avoid juggling per-field DOM mutations.
    this.cardSlot = document.createElement('div');
    this.cardSlot.className = 'proseBookmarkCardSlot';
    this.figureEl.appendChild(this.cardSlot);

    this.figcaptionEl = document.createElement('figcaption');
    this.figcaptionEl.className = 'proseBookmarkFigcaption';
    this.figureEl.appendChild(this.figcaptionEl);

    // Caption input lives outside the figure so theme CSS does not try
    // to style it. Shown only while the node is selected.
    this.captionInput = document.createElement('input');
    this.captionInput.type = 'text';
    this.captionInput.className = 'proseBookmarkCaption';
    this.captionInput.placeholder = 'Type caption (optional)';
    this.captionInput.hidden = true;
    this.captionInput.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        caption: this.captionInput.value,
      });
      this.view.dispatch(tr);
    });
    wrapper.appendChild(this.captionInput);

    this.actions = document.createElement('div');
    this.actions.className = 'proseBookmarkActions';
    this.actions.hidden = true;
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'proseBookmarkAction';
    replaceBtn.textContent = 'Replace';
    replaceBtn.addEventListener('mousedown', (e) => e.preventDefault());
    replaceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      options.onReplace?.(pos, this.node);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'proseBookmarkAction';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      this.view.dispatch(tr);
    });
    this.actions.appendChild(replaceBtn);
    this.actions.appendChild(removeBtn);
    wrapper.appendChild(this.actions);

    this.renderCard();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderCard();
    const caption = String(node.attrs.caption ?? '');
    if (this.captionInput.value !== caption) this.captionInput.value = caption;
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('proseBookmarkFigure--selected');
    this.actions.hidden = false;
    this.captionInput.hidden = false;
    this.captionInput.value = String(this.node.attrs.caption ?? '');
    this.figcaptionEl.hidden = true;
  }

  deselectNode(): void {
    this.dom.classList.remove('proseBookmarkFigure--selected');
    this.actions.hidden = true;
    this.captionInput.hidden = true;
    // Restore the figcaption visibility based on whether the caption is
    // actually populated. An empty figcaption would still take vertical
    // space if the theme styles it, so toggle the element itself.
    const caption = String(this.node.attrs.caption ?? '');
    this.figcaptionEl.hidden = caption === '';
    this.figcaptionEl.textContent = caption;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.captionInput;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // Listeners are bound to elements owned by `dom`; removing the
    // root node from the document is enough for GC.
  }

  private renderCard(): void {
    const url = String(this.node.attrs.url ?? '');
    const title = String(this.node.attrs.title ?? '') || url;
    const description = String(this.node.attrs.description ?? '');
    const icon = String(this.node.attrs.icon ?? '');
    const thumbnail = String(this.node.attrs.thumbnail ?? '');
    const publisher = String(this.node.attrs.publisher ?? '');
    const author = String(this.node.attrs.author ?? '');
    const caption = String(this.node.attrs.caption ?? '');

    const anchor = document.createElement('a');
    anchor.className = 'kg-bookmark-container';
    anchor.href = url || '#';
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';

    const content = document.createElement('div');
    content.className = 'kg-bookmark-content';

    const titleEl = document.createElement('div');
    titleEl.className = 'kg-bookmark-title';
    titleEl.textContent = title;
    content.appendChild(titleEl);

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'kg-bookmark-description';
      descEl.textContent = description;
      content.appendChild(descEl);
    }

    const metadata = document.createElement('div');
    metadata.className = 'kg-bookmark-metadata';
    if (icon) {
      const iconImg = document.createElement('img');
      iconImg.className = 'kg-bookmark-icon';
      iconImg.src = icon;
      iconImg.alt = '';
      metadata.appendChild(iconImg);
    }
    if (author) {
      const authorEl = document.createElement('span');
      authorEl.className = 'kg-bookmark-author';
      authorEl.textContent = author;
      metadata.appendChild(authorEl);
    }
    if (publisher) {
      const publisherEl = document.createElement('span');
      publisherEl.className = 'kg-bookmark-publisher';
      publisherEl.textContent = publisher;
      metadata.appendChild(publisherEl);
    }
    content.appendChild(metadata);
    anchor.appendChild(content);

    if (thumbnail) {
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'kg-bookmark-thumbnail';
      const thumb = document.createElement('img');
      thumb.src = thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumbWrap.appendChild(thumb);
      anchor.appendChild(thumbWrap);
    }

    this.cardSlot.replaceChildren(anchor);

    // Figcaption tracks the persisted caption when the node is not
    // selected; selectNode() hides it in favour of the input.
    this.figcaptionEl.textContent = caption;
    this.figcaptionEl.hidden = caption === '';
  }
}
