import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseNode } from 'prosemirror-model';
import { BOOKMARK_ATTR_KEYS, type BookmarkAttrs } from './prose-bookmark-schema.ts';

const BOOKMARK_LINE = /^\{\{<\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}\s*$/;
const ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;

function unescapeAttr(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

function escapeAttr(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

function parseAttrs(attrText: string): BookmarkAttrs {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (let m = ATTR_RE.exec(attrText); m !== null; m = ATTR_RE.exec(attrText)) {
    const key = m[1];
    const raw = m[2];
    if (!key || raw === undefined) continue;
    attrs[key] = unescapeAttr(raw);
  }
  const out: BookmarkAttrs = {
    url: '',
    title: '',
    description: '',
    icon: '',
    thumbnail: '',
    author: '',
    publisher: '',
    caption: '',
  };
  for (const k of BOOKMARK_ATTR_KEYS) {
    const v = attrs[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function bookmarkMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'paragraph',
    'bookmark',
    (state, startLine, _endLine, silent) => {
      const pos = (state.bMarks[startLine] as number) + (state.tShift[startLine] as number);
      const max = state.eMarks[startLine] as number;
      const line = state.src.slice(pos, max);
      const match = BOOKMARK_LINE.exec(line);
      if (!match) return false;
      if (silent) return true;
      const attrText = match[1] ?? '';
      const token: Token = state.push('bookmark', '', 0);
      token.markup = '{{< bookmark />}}';
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.meta = { attrs: parseAttrs(attrText) };
      state.line = startLine + 1;
      return true;
    },
    { alt: [] },
  );
}

export const bookmarkTokenHandler = {
  node: 'bookmark',
  getAttrs(tok: Token): BookmarkAttrs {
    const meta = tok.meta as { attrs?: BookmarkAttrs } | null;
    return (
      meta?.attrs ?? {
        url: '',
        title: '',
        description: '',
        icon: '',
        thumbnail: '',
        author: '',
        publisher: '',
        caption: '',
      }
    );
  },
};

export function bookmarkSerializerNode(state: MarkdownSerializerState, node: ProseNode): void {
  const pairs: string[] = [];
  for (const key of BOOKMARK_ATTR_KEYS) {
    const value = String(node.attrs[key] ?? '');
    if (!value) continue;
    pairs.push(`${key}="${escapeAttr(value)}"`);
  }
  const body = pairs.length > 0 ? ` ${pairs.join(' ')} ` : ' ';
  state.write(`{{< bookmark${body}/>}}`);
  state.closeBlock(node);
}
