// Always-on inline controls for image nodes.
//
// Renders each image as a <figure> with:
//   - the image itself
//   - a "×" delete button anchored to the top-right corner
//   - an alt-text <input> centered beneath the image, wrapped in
//     parentheses ("(…)") rendered via CSS ::before / ::after
//
// Replaces the bubble-menu-driven image edit row — controls are
// always visible while the image is, so discovery doesn't depend on
// clicking the image first. NodeView is the canonical ProseMirror
// extension point for swapping in a custom DOM tree per node type.
//
// We deliberately use `setNodeMarkup` for alt edits so the Markdown
// serializer still emits `![alt](src)` round-trip. Deletes only
// remove the node from the document — the file under
// `content/images/` is left alone (same as the bubble menu version)
// because it may be referenced from other posts and a stray asset
// is cheap to recover.

import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export class ImageNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly img: HTMLImageElement;
  private readonly altInput: HTMLInputElement;
  private readonly deleteBtn: HTMLButtonElement;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const figure = document.createElement('figure');
    figure.className = 'proseImageFigure';

    this.img = document.createElement('img');
    this.img.className = 'proseImageImg';
    this.img.src = String(node.attrs.src);
    this.img.alt = String(node.attrs.alt ?? '');
    figure.appendChild(this.img);

    this.deleteBtn = document.createElement('button');
    this.deleteBtn.type = 'button';
    this.deleteBtn.className = 'proseImageDelete';
    this.deleteBtn.title = 'Delete image';
    this.deleteBtn.setAttribute('aria-label', 'Delete image');
    // Two crossed strokes with round caps — reads as a copy-editor's
    // pencilled "delete" mark when the strokes pick up the warm
    // accent on hover. SVG over a text `×` so the strokes have
    // consistent weight and don't drift with the user's font stack.
    this.deleteBtn.appendChild(buildDeleteIcon());
    this.deleteBtn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.removeImage();
    });
    figure.appendChild(this.deleteBtn);

    const captionWrap = document.createElement('div');
    captionWrap.className = 'proseImageCaption';
    this.altInput = document.createElement('input');
    this.altInput.type = 'text';
    this.altInput.className = 'proseImageAlt';
    this.altInput.placeholder = 'alt text';
    this.altInput.value = String(node.attrs.alt ?? '');
    this.altInput.spellcheck = true;
    this.altInput.setAttribute('aria-label', 'Image alt text');
    this.altInput.addEventListener('input', () => this.commitAlt());
    // Auto-size the input width to the placeholder / typed length so
    // the caption stays centred under the image with snug parentheses
    // either side, no fixed-width gap.
    this.altInput.addEventListener('input', () => this.resizeAltInput());
    // ProseMirror normally treats arrow keys / enter as document
    // navigation. Inside our input the user expects normal text-edit
    // semantics, so we keep the event from bubbling up.
    this.altInput.addEventListener('keydown', (event) => event.stopPropagation());
    this.altInput.addEventListener('mousedown', (event) => event.stopPropagation());
    captionWrap.appendChild(this.altInput);
    figure.appendChild(captionWrap);

    this.dom = figure;
    // Initial size after the input is in the DOM (so .size assignment
    // actually has a font context to measure from).
    queueMicrotask(() => this.resizeAltInput());
  }

  private removeImage(): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  private commitAlt(): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const current = this.view.state.doc.nodeAt(pos);
    if (!current || current.type !== this.node.type) return;
    const next = this.altInput.value;
    if (String(current.attrs.alt ?? '') === next) return;
    const newAttrs = { ...current.attrs, alt: next };
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, newAttrs));
  }

  private resizeAltInput(): void {
    const length = Math.max(this.altInput.value.length, this.altInput.placeholder.length, 4);
    this.altInput.size = length;
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const nextSrc = String(node.attrs.src);
    const nextAlt = String(node.attrs.alt ?? '');
    if (this.img.getAttribute('src') !== nextSrc) this.img.src = nextSrc;
    if (this.img.alt !== nextAlt) this.img.alt = nextAlt;
    // Avoid clobbering a half-typed value while the user is focused
    // on the input.
    if (document.activeElement !== this.altInput && this.altInput.value !== nextAlt) {
      this.altInput.value = nextAlt;
      this.resizeAltInput();
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target;
    if (target === this.altInput) return true;
    if (target === this.deleteBtn) return true;
    return false;
  }

  ignoreMutations(): boolean {
    // The figure's DOM tree is entirely managed by this NodeView, so
    // ProseMirror should not try to reconcile our caption / button.
    return true;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildDeleteIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M4.6 4.6 L11.4 11.4', 'M11.4 4.6 L4.6 11.4']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }
  return svg;
}
