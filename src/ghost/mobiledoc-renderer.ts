// Render Ghost's Koenig Mobiledoc JSON to HTML. Mobiledoc was the post body
// format for Ghost 1.x–4.x and still appears in old exports (and in 5.x
// exports for posts that haven't been re-saved since the upgrade). Without a
// renderer the importer silently emits an empty body for any Mobiledoc post.
//
// Spec: https://github.com/bustle/mobiledoc-kit/blob/master/MOBILEDOC.md
//
// The output mirrors Ghost's published HTML shape (kg-card classes, fence
// comments) so the same turndown pipeline used for the `html` field consumes
// it without changes.

import { logger } from '~/util/logger.ts';
import {
  escapeAttr,
  escapeHtml,
  renderAudioCardHtml,
  renderBookmarkCardHtml,
  renderButtonCardHtml,
  renderCalloutCardHtml,
  renderCodeCardHtml,
  renderEmbedCardHtml,
  renderFileCardHtml,
  renderGalleryCardHtml,
  renderHtmlCardHtml,
  renderImageCardHtml,
  renderMarkdownCardHtml,
  renderProductCardHtml,
  renderToggleCardHtml,
  renderVideoCardHtml,
} from './koenig-card-html.ts';

// Section type identifiers per the mobiledoc spec.
const SECTION_MARKUP = 1;
const SECTION_IMAGE = 2; // deprecated, still appears in old exports
const SECTION_LIST = 3;
const SECTION_CARD = 10;

// Marker textType identifiers.
const MARKER_TEXT = 0;
const MARKER_ATOM = 1;

type Markup = [string, string[]?]; // ["a", ["href", "url"]]
type Atom = [string, string, Record<string, unknown>]; // [name, text, payload]
type Card = [string, Record<string, unknown>]; // [name, payload]
type Marker = [number, number[], number, string | number];
type MarkupSection = [1, string, Marker[]];
type ImageSection = [2, string];
type ListSection = [3, string, Marker[][]];
type CardSection = [10, number];
type Section = MarkupSection | ImageSection | ListSection | CardSection;

interface Mobiledoc {
  version?: string;
  atoms?: Atom[];
  cards?: Card[];
  markups?: Markup[];
  sections?: Section[];
}

const VALID_MARKUP_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'aside',
  'pull-quote',
]);

const VALID_LIST_TAGS = new Set(['ul', 'ol']);

export function renderMobiledocToHtml(json: string | null | undefined): string {
  if (typeof json !== 'string' || json.trim() === '') return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    logger.warn(
      `Mobiledoc body is not valid JSON, skipping: ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const doc = parsed as Mobiledoc;
  if (!Array.isArray(doc.sections)) return '';

  const cards = Array.isArray(doc.cards) ? doc.cards : [];
  const atoms = Array.isArray(doc.atoms) ? doc.atoms : [];
  const markups = Array.isArray(doc.markups) ? doc.markups : [];

  return doc.sections
    .map((section) => renderSection(section, markups, atoms, cards))
    .filter((s) => s !== '')
    .join('');
}

function renderSection(section: unknown, markups: Markup[], atoms: Atom[], cards: Card[]): string {
  if (!Array.isArray(section) || section.length === 0) return '';
  const kind = section[0];
  switch (kind) {
    case SECTION_MARKUP: {
      const tag = typeof section[1] === 'string' ? section[1] : 'p';
      const safeTag = VALID_MARKUP_TAGS.has(tag) ? tag : 'p';
      const markers = Array.isArray(section[2]) ? (section[2] as Marker[]) : [];
      const inner = renderMarkers(markers, markups, atoms);
      // `pull-quote` renders as <aside class="pull-quote"> in Ghost.
      if (safeTag === 'pull-quote') {
        return `<aside class="pull-quote">${inner}</aside>`;
      }
      return `<${safeTag}>${inner}</${safeTag}>`;
    }
    case SECTION_IMAGE: {
      const src = typeof section[1] === 'string' ? section[1] : '';
      if (!src) return '';
      return `<figure class="kg-card kg-image-card"><img src="${escapeAttr(src)}" alt=""></figure>`;
    }
    case SECTION_LIST: {
      const tag = typeof section[1] === 'string' ? section[1] : 'ul';
      const safeTag = VALID_LIST_TAGS.has(tag) ? tag : 'ul';
      const items = Array.isArray(section[2]) ? (section[2] as Marker[][]) : [];
      const lis = items.map((mks) => `<li>${renderMarkers(mks, markups, atoms)}</li>`).join('');
      return `<${safeTag}>${lis}</${safeTag}>`;
    }
    case SECTION_CARD: {
      const idx = typeof section[1] === 'number' ? section[1] : -1;
      const card = cards[idx];
      if (!Array.isArray(card) || card.length < 1) return '';
      const [name, payload] = card;
      return renderCard(name, payload ?? {});
    }
    default:
      return '';
  }
}

// Walk a marker run, opening tags when their markup index appears in
// `openedMarkups` and closing the indicated count at the end of each marker.
function renderMarkers(markers: Marker[], markups: Markup[], atoms: Atom[]): string {
  const openStack: number[] = [];
  let out = '';
  for (const marker of markers) {
    if (!Array.isArray(marker) || marker.length < 4) continue;
    const [textType, openedMarkups, numClosed, value] = marker;
    if (Array.isArray(openedMarkups)) {
      for (const m of openedMarkups) {
        out += openMarkup(markups[m]);
        openStack.push(m);
      }
    }
    if (textType === MARKER_TEXT) {
      out += escapeHtml(typeof value === 'string' ? value : '');
    } else if (textType === MARKER_ATOM) {
      const atomIdx = typeof value === 'number' ? value : -1;
      const atom = atoms[atomIdx];
      if (Array.isArray(atom)) {
        out += renderAtom(atom);
      }
    }
    const closeCount = typeof numClosed === 'number' ? numClosed : 0;
    for (let i = 0; i < closeCount; i++) {
      const idx = openStack.pop();
      if (idx === undefined) break;
      out += closeMarkup(markups[idx]);
    }
  }
  // Close any markups left open (defensive — well-formed mobiledoc always
  // balances them per marker run).
  while (openStack.length > 0) {
    const idx = openStack.pop();
    if (idx === undefined) break;
    out += closeMarkup(markups[idx]);
  }
  return out;
}

function openMarkup(markup: Markup | undefined): string {
  if (!Array.isArray(markup) || typeof markup[0] !== 'string') return '';
  const tag = markup[0];
  const rawAttrs = Array.isArray(markup[1]) ? markup[1] : [];
  const attrs: string[] = [];
  for (let i = 0; i < rawAttrs.length; i += 2) {
    const k = rawAttrs[i];
    const v = rawAttrs[i + 1];
    if (typeof k === 'string' && typeof v === 'string') {
      attrs.push(`${k}="${escapeAttr(v)}"`);
    }
  }
  return attrs.length === 0 ? `<${tag}>` : `<${tag} ${attrs.join(' ')}>`;
}

function closeMarkup(markup: Markup | undefined): string {
  if (!Array.isArray(markup) || typeof markup[0] !== 'string') return '';
  return `</${markup[0]}>`;
}

// Ghost rarely uses atoms in practice (the soft-return atom is the main one),
// but render the text fallback so unfamiliar atom names degrade gracefully.
function renderAtom(atom: Atom): string {
  const name = atom[0];
  const text = atom[1];
  if (name === 'soft-return') return '<br>';
  return typeof text === 'string' ? escapeHtml(text) : '';
}

function renderCard(name: unknown, payload: Record<string, unknown>): string {
  if (typeof name !== 'string') return '';
  switch (name) {
    case 'image':
      return renderImageCardHtml(payload);
    case 'html':
      return renderHtmlCardHtml(payload);
    case 'markdown':
      return renderMarkdownCardHtml(payload);
    case 'code':
      return renderCodeCardHtml(payload);
    case 'bookmark':
      return renderBookmarkCardHtml(payload);
    case 'callout':
      return renderCalloutCardHtml(payload);
    case 'button':
      return renderButtonCardHtml(payload);
    case 'embed':
      return renderEmbedCardHtml(payload);
    case 'file':
      return renderFileCardHtml(payload);
    case 'gallery':
      return renderGalleryCardHtml(payload);
    case 'audio':
      return renderAudioCardHtml(payload);
    case 'video':
      return renderVideoCardHtml(payload);
    case 'toggle':
      return renderToggleCardHtml(payload);
    case 'product':
      return renderProductCardHtml(payload);
    case 'hr':
    case 'horizontalrule':
      return '<hr>';
    // Members-only — skip so gated content never leaks into a public site.
    case 'paywall':
    case 'email':
    case 'email-cta':
    case 'signup':
    case 'header':
      return '';
    default:
      return '';
  }
}
