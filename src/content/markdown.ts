import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import sanitizeHtml, { type IOptions } from 'sanitize-html';

const marked = new Marked({ gfm: true, breaks: false });
marked.use(gfmHeadingId());

export interface RenderedMarkdown {
  html: string;
  plaintext: string;
  word_count: number;
  reading_time: number;
}

export interface RenderMarkdownOptions {
  // When true, raw HTML in the markdown is passed through verbatim. Only enable
  // for fully trusted authors — raw <script>, event handlers, or javascript:
  // URLs would otherwise reach readers as stored XSS.
  unsafe?: boolean;
}

const sanitizeOptions: IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    'video',
    'audio',
    'track',
    'details',
    'summary',
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['id', 'class', 'lang', 'dir', 'title'],
    a: ['href', 'name', 'target', 'rel', 'hreflang'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'srcset', 'type', 'media', 'sizes'],
    video: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'muted', 'loop'],
    audio: ['src', 'controls', 'preload', 'loop'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    source: ['http', 'https'],
    video: ['http', 'https'],
    audio: ['http', 'https'],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

export function sanitizeRenderedHtml(html: string): string {
  return sanitizeHtml(html, sanitizeOptions);
}

export async function renderMarkdown(
  body: string,
  options: RenderMarkdownOptions = {},
): Promise<RenderedMarkdown> {
  const raw = await marked.parse(body);
  const html = options.unsafe ? raw : sanitizeRenderedHtml(raw);
  const plaintext = htmlToPlaintext(html);
  const word_count = countWords(plaintext);
  const reading_time = Math.max(1, Math.round(word_count / 275));
  return { html, plaintext, word_count, reading_time };
}

function htmlToPlaintext(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
