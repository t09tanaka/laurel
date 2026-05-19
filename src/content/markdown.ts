import { Marked } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';

const marked = new Marked({ gfm: true, breaks: false });
marked.use(gfmHeadingId());

export interface RenderedMarkdown {
  html: string;
  plaintext: string;
  word_count: number;
  reading_time: number;
}

export async function renderMarkdown(body: string): Promise<RenderedMarkdown> {
  const html = await marked.parse(body);
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
