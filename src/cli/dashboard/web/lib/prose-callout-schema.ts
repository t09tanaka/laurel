import type { NodeSpec } from 'prosemirror-model';

// Ghost Koenig callout colours. The server (src/content/markdown.ts) emits
// `kg-callout-card-{color}` and clamps unknown tokens, so the editor keeps the
// same set the published themes actually style.
export const CALLOUT_COLORS = [
  'grey',
  'white',
  'blue',
  'green',
  'yellow',
  'red',
  'pink',
  'purple',
  'accent',
] as const;

export type CalloutColor = (typeof CALLOUT_COLORS)[number];

export const DEFAULT_CALLOUT_COLOR: CalloutColor = 'grey';
export const DEFAULT_CALLOUT_EMOJI = '💡';

// Shortcode attribute names we model with first-class node attrs. Everything
// else round-trips through `extra` untouched so opening + saving a post never
// drops data (e.g. `emoji-html`, width tokens).
export const KNOWN_CALLOUT_ATTR_NAMES = new Set(['emoji', 'color', 'no-icon']);

export interface CalloutAttrs {
  emoji: string;
  color: CalloutColor;
  noIcon: boolean;
  extra: Record<string, string>;
}

export function clampCalloutColor(value: string): CalloutColor {
  return (CALLOUT_COLORS as readonly string[]).includes(value)
    ? (value as CalloutColor)
    : DEFAULT_CALLOUT_COLOR;
}

interface CalloutDomElement {
  getAttribute(name: string): string | null;
  textContent: string | null;
  className?: string;
  querySelector(selector: string): CalloutDomElement | null;
}

function isCalloutDomElement(value: unknown): value is CalloutDomElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'querySelector' in value &&
    typeof (value as { querySelector: unknown }).querySelector === 'function'
  );
}

function classListOf(dom: CalloutDomElement): string {
  if (typeof dom.className === 'string') return dom.className;
  return dom.getAttribute('class') ?? '';
}

function colorFromClass(className: string): CalloutColor {
  const match = /kg-callout-card-([a-z][a-z0-9-]*)/.exec(className);
  // `kg-callout-card-without-emoji` is a modifier, not a colour.
  if (match?.[1] && match[1] !== 'without-emoji') return clampCalloutColor(match[1]);
  return DEFAULT_CALLOUT_COLOR;
}

export const calloutNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    emoji: { default: DEFAULT_CALLOUT_EMOJI },
    color: { default: DEFAULT_CALLOUT_COLOR },
    noIcon: { default: false },
    extra: { default: {} },
  },
  // The NodeView replaces this in the editor; the fallback DOM keeps
  // prosemirror-model invariants satisfied and makes copy/paste between
  // editors carry the body through `.kg-callout-text` (the content hole).
  toDOM(node) {
    const color = clampCalloutColor(String(node.attrs.color ?? ''));
    const noIcon = node.attrs.noIcon === true;
    const classes = ['kg-card', 'kg-callout-card', `kg-callout-card-${color}`];
    if (noIcon) classes.push('kg-callout-card-without-emoji');
    if (noIcon) {
      return ['div', { class: classes.join(' ') }, ['div', { class: 'kg-callout-text' }, 0]];
    }
    return [
      'div',
      { class: classes.join(' ') },
      ['div', { class: 'kg-callout-emoji' }, String(node.attrs.emoji ?? '')],
      ['div', { class: 'kg-callout-text' }, 0],
    ];
  },
  parseDOM: [
    {
      tag: 'div.kg-callout-card',
      contentElement: '.kg-callout-text',
      getAttrs(dom) {
        if (!isCalloutDomElement(dom)) return false;
        const className = classListOf(dom);
        const color = colorFromClass(className);
        const noIcon = /\bkg-callout-card-without-emoji\b/.test(className);
        const emoji = dom.querySelector('.kg-callout-emoji')?.textContent?.trim() ?? '';
        return { emoji, color, noIcon, extra: {} };
      },
    },
  ],
};
