import type { NodeSpec } from 'prosemirror-model';

export interface ComponentAttrs {
  slug: string;
  description: string;
  css: string;
  html: string;
}

export const COMPONENT_ATTR_KEYS = ['slug', 'description', 'css', 'html'] as const;

export const EMPTY_COMPONENT_ATTRS: ComponentAttrs = {
  slug: '',
  description: '',
  css: '',
  html: '',
};

export const componentNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    slug: { default: '' },
    description: { default: '' },
    css: { default: '' },
    html: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div[data-laurel-component]',
      getAttrs(dom): ComponentAttrs {
        const el = dom as {
          getAttribute?: (name: string) => string | null;
          innerHTML?: string;
        };
        if (typeof el.getAttribute !== 'function') return EMPTY_COMPONENT_ATTRS;
        return {
          slug: el.getAttribute('data-laurel-component') ?? '',
          description: el.getAttribute('data-description') ?? '',
          css: '',
          html: el.innerHTML ?? '',
        };
      },
    },
  ],
  toDOM(node) {
    const slug = String(node.attrs.slug ?? '');
    return ['div', { 'data-laurel-component': slug }, `{${slug}}`];
  },
};
