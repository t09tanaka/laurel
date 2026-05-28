import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export class ComponentNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly content: HTMLElement;
  private readonly deleteBtn: HTMLButtonElement;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    const wrapper = document.createElement('div');
    wrapper.className = 'proseBookmarkScope proseComponentFigure';
    wrapper.dataset.componentSlug = String(node.attrs.slug ?? '');

    this.content = document.createElement('div');
    this.content.className = 'proseComponentRendered';
    this.content.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('a')) event.preventDefault();
    });
    wrapper.appendChild(this.content);

    this.deleteBtn = document.createElement('button');
    this.deleteBtn.type = 'button';
    this.deleteBtn.className = 'proseImageDelete proseComponentDelete';
    this.deleteBtn.title = 'Delete component';
    this.deleteBtn.setAttribute('aria-label', 'Delete component');
    this.deleteBtn.appendChild(buildDeleteIcon());
    this.deleteBtn.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.removeComponent();
    });
    wrapper.appendChild(this.deleteBtn);

    this.dom = wrapper;
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.dom.dataset.componentSlug = String(node.attrs.slug ?? '');
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.deleteBtn;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private removeComponent(): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  private render(): void {
    const html = String(this.node.attrs.html ?? '').trim();
    const css = String(this.node.attrs.css ?? '').trim();
    const slug = String(this.node.attrs.slug ?? '');
    this.content.replaceChildren();
    if (css) {
      const style = document.createElement('style');
      style.textContent = css;
      this.content.appendChild(style);
    }
    if (html) {
      this.content.appendChild(sanitizeComponentPreviewHtml(html));
      return;
    }
    const empty = document.createElement('div');
    empty.className = 'proseComponentEmpty';
    empty.textContent = slug ? `{${slug}} has no HTML` : 'Component has no HTML';
    this.content.appendChild(empty);
  }
}

export function sanitizeComponentPreviewHtml(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'script') {
      element.remove();
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' ||
          name === 'src' ||
          name === 'xlink:href' ||
          name === 'action' ||
          name === 'formaction') &&
        /^javascript:/i.test(value)
      ) {
        element.removeAttribute(attr.name);
      }
      if (name === 'srcset' && /(?:^|,)\s*javascript:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      element.rel = 'noreferrer noopener';
    }
    if (element instanceof HTMLImageElement && !element.loading) {
      element.loading = 'lazy';
    }
  }
  return template.content;
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
