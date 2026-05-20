// Render Ghost's Koenig Lexical JSON to HTML. Ghost stores post bodies as
// Lexical JSON since 5.x; the legacy `html` column is only repopulated when
// the editor saves, so JSON exports from active sites routinely ship a
// `lexical` field with `html: null`. Without a renderer the importer drops
// every Ghost ≥ 5.x post body to an empty string (#127).
//
// The output mirrors the shape Ghost's own renderer would have produced, so
// the existing `createGhostTurndown()` pipeline can consume it unchanged
// (kg-card class wrappers, kg-card-begin/end fences, etc.).

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
  renderHeaderCardHtml,
  renderHtmlCardHtml,
  renderImageCardHtml,
  renderMarkdownCardHtml,
  renderProductCardHtml,
  renderToggleCardHtml,
  renderVideoCardHtml,
} from './koenig-card-html.ts';

// Lexical text format bitfield. See @lexical/core: `IS_BOLD = 1 << 0`, etc.
const FORMAT_BOLD = 1 << 0;
const FORMAT_ITALIC = 1 << 1;
const FORMAT_STRIKETHROUGH = 1 << 2;
const FORMAT_UNDERLINE = 1 << 3;
const FORMAT_CODE = 1 << 4;
const FORMAT_SUBSCRIPT = 1 << 5;
const FORMAT_SUPERSCRIPT = 1 << 6;
const FORMAT_HIGHLIGHT = 1 << 7;

export function renderLexicalToHtml(json: string | null | undefined): string {
  if (typeof json !== 'string' || json.trim() === '') return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    logger.warn(
      `Lexical body is not valid JSON, skipping: ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const root = (parsed as { root?: unknown }).root;
  return renderNodeChildren(root);
}

function renderNodeChildren(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return '';
  return children.map(renderNode).join('');
}

function renderNode(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const type = (node as { type?: unknown }).type;
  if (typeof type !== 'string') return '';

  switch (type) {
    case 'paragraph': {
      const inner = renderNodeChildren(node);
      // An empty paragraph in Lexical is a deliberate blank line; emit a real
      // paragraph so turndown preserves the gap rather than collapsing it.
      return `<p>${inner}</p>`;
    }
    case 'heading': {
      const tag = (node as { tag?: unknown }).tag;
      const t = typeof tag === 'string' && /^h[1-6]$/.test(tag) ? tag : 'h2';
      return `<${t}>${renderNodeChildren(node)}</${t}>`;
    }
    case 'list': {
      const listType = (node as { listType?: unknown }).listType;
      const tag = listType === 'number' ? 'ol' : 'ul';
      return `<${tag}>${renderNodeChildren(node)}</${tag}>`;
    }
    case 'listitem':
      return `<li>${renderNodeChildren(node)}</li>`;
    case 'quote':
      return `<blockquote>${renderNodeChildren(node)}</blockquote>`;
    case 'linebreak':
      return '<br>';
    case 'tab':
      return '\t';
    case 'text':
    case 'extended-text':
      return renderText(node);
    case 'link':
    case 'autolink':
      return renderLink(node);
    case 'horizontalrule':
    case 'hr':
      return '<hr>';
    case 'image':
      return renderImageCardHtml(node);
    case 'html':
      return renderHtmlCardHtml(node);
    case 'markdown':
      return renderMarkdownCardHtml(node);
    case 'code':
    case 'codeblock':
      return renderCodeCardHtml(node);
    case 'bookmark':
      return renderBookmarkCardHtml(node);
    case 'callout':
      return renderCalloutCardHtml(node);
    case 'button':
      return renderButtonCardHtml(node);
    case 'embed':
      return renderEmbedCardHtml(node);
    case 'file':
      return renderFileCardHtml(node);
    case 'gallery':
      return renderGalleryCardHtml(node);
    case 'audio':
      return renderAudioCardHtml(node);
    case 'video':
      return renderVideoCardHtml(node);
    case 'toggle':
      return renderToggleCardHtml(node);
    case 'product':
      return renderProductCardHtml(node);
    case 'header':
      return renderHeaderCardHtml(node);
    case 'paywall':
      return '<!--members-only-->';
    // Newsletter-only and signup cards should not render on the public web.
    case 'email':
    case 'email-cta':
    case 'signup':
      return '';
    default:
      // Unknown node: walk children if any so nested text isn't lost. Common
      // case is third-party Koenig plugin nodes that wrap standard children.
      return renderNodeChildren(node);
  }
}

function renderText(node: unknown): string {
  const text = (node as { text?: unknown }).text;
  if (typeof text !== 'string' || text === '') return '';
  const format = (node as { format?: unknown }).format;
  const escaped = escapeHtml(text);
  if (typeof format !== 'number' || format === 0) return escaped;

  // Wrap in order so the final markup reads bold(italic(rest)). Reversed order
  // (inside-out below) yields strong > em > … which is how Ghost emits it too.
  let out = escaped;
  if (format & FORMAT_CODE) out = `<code>${out}</code>`;
  if (format & FORMAT_SUBSCRIPT) out = `<sub>${out}</sub>`;
  if (format & FORMAT_SUPERSCRIPT) out = `<sup>${out}</sup>`;
  if (format & FORMAT_HIGHLIGHT) out = `<mark>${out}</mark>`;
  if (format & FORMAT_STRIKETHROUGH) out = `<s>${out}</s>`;
  if (format & FORMAT_UNDERLINE) out = `<u>${out}</u>`;
  if (format & FORMAT_ITALIC) out = `<em>${out}</em>`;
  if (format & FORMAT_BOLD) out = `<strong>${out}</strong>`;
  return out;
}

function renderLink(node: unknown): string {
  const url = (node as { url?: unknown }).url;
  const inner = renderNodeChildren(node);
  if (typeof url !== 'string' || url === '') return inner;
  const rel = (node as { rel?: unknown }).rel;
  const target = (node as { target?: unknown }).target;
  const attrs = [
    `href="${escapeAttr(url)}"`,
    typeof target === 'string' && target ? `target="${escapeAttr(target)}"` : '',
    typeof rel === 'string' && rel ? `rel="${escapeAttr(rel)}"` : '',
  ]
    .filter((s) => s !== '')
    .join(' ');
  return `<a ${attrs}>${inner}</a>`;
}
