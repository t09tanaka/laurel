import type { NodeSpec } from 'prosemirror-model';

export const BOOKMARK_ATTR_KEYS = [
  'url',
  'title',
  'description',
  'icon',
  'thumbnail',
  'author',
  'publisher',
  'caption',
] as const;

export type BookmarkAttrKey = (typeof BOOKMARK_ATTR_KEYS)[number];

export type BookmarkAttrs = { [K in BookmarkAttrKey]: string };

interface BookmarkDomElement {
  getAttribute(name: string): string | null;
  textContent: string | null;
  querySelector(selector: string): BookmarkDomElement | null;
}

function emptyAttrs(): Record<BookmarkAttrKey, { default: string }> {
  return Object.fromEntries(BOOKMARK_ATTR_KEYS.map((k) => [k, { default: '' }])) as Record<
    BookmarkAttrKey,
    { default: string }
  >;
}

function isBookmarkDomElement(value: unknown): value is BookmarkDomElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'querySelector' in value &&
    typeof value.querySelector === 'function'
  );
}

export const bookmarkNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: emptyAttrs(),
  // The NodeView replaces toDOM in the editor. We keep a minimal
  // fallback DOM so prosemirror-model's invariants are satisfied and
  // copy/paste between editors works at all.
  toDOM(node) {
    return [
      'figure',
      { class: 'kg-card kg-bookmark-card', 'data-url': String(node.attrs.url ?? '') },
      ['a', { class: 'kg-bookmark-container', href: String(node.attrs.url ?? '') }, ''],
    ];
  },
  parseDOM: [
    {
      tag: 'figure.kg-card.kg-bookmark-card',
      getAttrs(dom) {
        if (!isBookmarkDomElement(dom)) return false;
        const anchor = dom.querySelector('a.kg-bookmark-container');
        const url = anchor?.getAttribute('href') ?? '';
        const title = dom.querySelector('.kg-bookmark-title')?.textContent ?? '';
        const description = dom.querySelector('.kg-bookmark-description')?.textContent ?? '';
        const author = dom.querySelector('.kg-bookmark-author')?.textContent ?? '';
        const publisher = dom.querySelector('.kg-bookmark-publisher')?.textContent ?? '';
        const icon = dom.querySelector('.kg-bookmark-icon')?.getAttribute('src') ?? '';
        const thumbnail =
          dom.querySelector('.kg-bookmark-thumbnail img')?.getAttribute('src') ?? '';
        const caption = dom.querySelector('figcaption')?.textContent ?? '';
        return { url, title, description, icon, thumbnail, author, publisher, caption };
      },
    },
  ],
};
