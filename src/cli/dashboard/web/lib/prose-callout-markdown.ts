import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseNode } from 'prosemirror-model';
import {
  type CalloutAttrs,
  DEFAULT_CALLOUT_COLOR,
  KNOWN_CALLOUT_ATTR_NAMES,
  clampCalloutColor,
} from './prose-callout-schema.ts';

// Opening markers, captured at the *start* of a line. Group 1 is the raw attr
// run; whatever follows the marker on the line is body. Ghost's editor and the
// server both accept the Hugo-style `{{< >}}` and the Liquid-style `{% %}`
// delimiters, so we parse both and normalise to `{{< >}}` on serialise.
const OPEN_ANGLE = /^\{\{<\s+callout((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*>\}\}/;
const OPEN_LIQUID = /^\{%\s+callout((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*%\}/;
const CLOSE_ANGLE = /\{\{<\s*\/callout\s*>\}\}/;
const CLOSE_LIQUID = /\{%\s*\/callout\s*%\}/;
const ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;

function unescapeAttr(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

function escapeAttr(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

export function parseCalloutAttrs(attrText: string): CalloutAttrs {
  const raw: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  for (let m = ATTR_RE.exec(attrText); m !== null; m = ATTR_RE.exec(attrText)) {
    const key = m[1];
    const value = m[2];
    if (!key || value === undefined) continue;
    raw[key] = unescapeAttr(value);
  }
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_CALLOUT_ATTR_NAMES.has(k)) extra[k] = v;
  }
  return {
    emoji: raw.emoji ?? '',
    color: raw.color ? clampCalloutColor(raw.color) : DEFAULT_CALLOUT_COLOR,
    noIcon: raw['no-icon'] === 'true',
    extra,
  };
}

// Locate the markdown-it line index that follows the line containing the close
// marker, given the close marker's exclusive end offset in `state.src`.
function lineAfterOffset(
  eMarks: number[],
  startLine: number,
  endLine: number,
  offset: number,
): number {
  const lastCharPos = offset - 1;
  for (let line = startLine; line < endLine; line += 1) {
    if (lastCharPos <= (eMarks[line] ?? 0)) return line + 1;
  }
  return endLine;
}

export function calloutMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'paragraph',
    'callout',
    (state, startLine, endLine, silent) => {
      const lineStart = (state.bMarks[startLine] as number) + (state.tShift[startLine] as number);
      const lineEnd = state.eMarks[startLine] as number;
      const firstLine = state.src.slice(lineStart, lineEnd);

      const angle = OPEN_ANGLE.exec(firstLine);
      const liquid = angle ? null : OPEN_LIQUID.exec(firstLine);
      const open = angle ?? liquid;
      if (!open) return false;

      const closeRe = liquid ? CLOSE_LIQUID : CLOSE_ANGLE;
      const searchFrom = lineStart + open[0].length;
      const rest = state.src.slice(searchFrom);
      const closeMatch = closeRe.exec(rest);
      // A callout without a matching close is not a callout — leave it for the
      // paragraph rule so the raw text round-trips untouched.
      if (!closeMatch) return false;
      if (silent) return true;

      const body = rest.slice(0, closeMatch.index);
      const closeEnd = searchFrom + closeMatch.index + closeMatch[0].length;
      const nextLine = lineAfterOffset(state.eMarks as number[], startLine, endLine, closeEnd);

      const attrs = parseCalloutAttrs(open[1] ?? '');

      const openTok = state.push('callout_open', 'div', 1);
      openTok.markup = '{{< callout >}}';
      openTok.block = true;
      openTok.map = [startLine, nextLine];
      openTok.meta = { attrs };

      // Re-parse the body as block markdown so lists, headings, nested cards,
      // etc. become real child nodes. We use `block.parse` (not the full
      // `parse`) on purpose: it leaves each `inline` token's `children` empty
      // so the outer core `inline` rule fills them exactly once — running the
      // full parse here pre-fills children and the outer pass then *appends* a
      // duplicate. createAndFill backfills an empty paragraph when the body is
      // blank, so `content: 'block+'` stays satisfied.
      const bodyTokens: Token[] = [];
      md.block.parse(body.trim(), md, state.env, bodyTokens);
      for (const tok of bodyTokens) state.tokens.push(tok);

      state.push('callout_close', 'div', -1);

      state.line = nextLine;
      return true;
    },
    { alt: ['paragraph', 'blockquote', 'list'] },
  );
}

export const calloutTokenHandler = {
  block: 'callout',
  getAttrs(tok: Token): CalloutAttrs {
    const meta = tok.meta as { attrs?: CalloutAttrs } | null;
    return (
      meta?.attrs ?? {
        emoji: '',
        color: DEFAULT_CALLOUT_COLOR,
        noIcon: false,
        extra: {},
      }
    );
  },
};

function buildCalloutAttrs(attrs: CalloutAttrs): string {
  const extra = attrs.extra ?? {};
  const hasEmojiHtml = typeof extra['emoji-html'] === 'string' && extra['emoji-html'] !== '';
  const pairs: string[] = [];
  // Skip the unicode `emoji` attr when a custom `emoji-html` slot owns the
  // icon, matching the server's precedence (calloutEmojiSlotHtml).
  if (attrs.emoji && !hasEmojiHtml) pairs.push(`emoji="${escapeAttr(attrs.emoji)}"`);
  pairs.push(`color="${attrs.color}"`);
  if (attrs.noIcon) pairs.push('no-icon="true"');
  for (const [key, value] of Object.entries(extra)) {
    if (KNOWN_CALLOUT_ATTR_NAMES.has(key)) continue;
    if (typeof value !== 'string' || value === '') continue;
    pairs.push(`${key}="${escapeAttr(value)}"`);
  }
  return pairs.length > 0 ? ` ${pairs.join(' ')}` : '';
}

export function calloutSerializerNode(state: MarkdownSerializerState, node: ProseNode): void {
  state.write(`{{< callout${buildCalloutAttrs(node.attrs as CalloutAttrs)} >}}`);
  state.write('\n\n');
  state.renderContent(node);
  state.write('{{< /callout >}}');
  state.closeBlock(node);
}
