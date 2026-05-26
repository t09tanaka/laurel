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
  private readonly card: HTMLElement;
  private readonly captionInput: HTMLInputElement;
  private readonly actions: HTMLElement;

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

    const figure = document.createElement('figure');
    figure.className = 'proseBookmarkFigure';
    this.dom = figure;

    this.card = document.createElement('div');
    this.card.className = 'proseBookmarkCard';
    figure.appendChild(this.card);

    this.captionInput = document.createElement('input');
    this.captionInput.type = 'text';
    this.captionInput.className = 'proseBookmarkCaption';
    this.captionInput.placeholder = 'Type caption (optional)';
    this.captionInput.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        caption: this.captionInput.value,
      });
      this.view.dispatch(tr);
    });
    figure.appendChild(this.captionInput);

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
    figure.appendChild(this.actions);

    this.renderCard();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderCard();
    if (this.captionInput.value !== String(node.attrs.caption ?? '')) {
      this.captionInput.value = String(node.attrs.caption ?? '');
    }
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('proseBookmarkFigure--selected');
    this.actions.hidden = false;
  }

  deselectNode(): void {
    this.dom.classList.remove('proseBookmarkFigure--selected');
    this.actions.hidden = true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.captionInput;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // Nothing else to release — listeners are bound to elements owned by `dom`.
  }

  private renderCard(): void {
    const url = String(this.node.attrs.url ?? '');
    const title = String(this.node.attrs.title ?? '') || url;
    const description = String(this.node.attrs.description ?? '');
    const icon = String(this.node.attrs.icon ?? '');
    const thumbnail = String(this.node.attrs.thumbnail ?? '');
    const publisher = String(this.node.attrs.publisher ?? '');
    const author = String(this.node.attrs.author ?? '');

    const content = document.createElement('a');
    content.className = 'proseBookmarkLink';
    content.href = url || '#';
    content.target = '_blank';
    content.rel = 'noreferrer noopener';

    const text = document.createElement('div');
    text.className = 'proseBookmarkText';
    const titleEl = document.createElement('div');
    titleEl.className = 'proseBookmarkTitle';
    titleEl.textContent = title;
    text.appendChild(titleEl);
    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'proseBookmarkDescription';
      descEl.textContent = description;
      text.appendChild(descEl);
    }
    const meta = document.createElement('div');
    meta.className = 'proseBookmarkMeta';
    if (icon) {
      const iconImg = document.createElement('img');
      iconImg.className = 'proseBookmarkIcon';
      iconImg.src = icon;
      iconImg.alt = '';
      meta.appendChild(iconImg);
    }
    const metaText = document.createElement('span');
    metaText.className = 'proseBookmarkMetaText';
    metaText.textContent = [publisher, author].filter(Boolean).join(' · ');
    meta.appendChild(metaText);
    text.appendChild(meta);
    content.appendChild(text);

    if (thumbnail) {
      const thumb = document.createElement('img');
      thumb.className = 'proseBookmarkThumbnail';
      thumb.src = thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      content.appendChild(thumb);
    }

    this.card.replaceChildren(content);
  }
}
