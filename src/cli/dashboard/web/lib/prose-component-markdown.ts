import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as ProseNode } from 'prosemirror-model';
import { type ComponentAttrs, EMPTY_COMPONENT_ATTRS } from './prose-component-schema.ts';
import { COMPONENT_SLUG_PATTERN, type ComponentEntry } from './prose-insert-menu-logic.ts';

const COMPONENT_LINE = /^\{([A-Za-z][A-Za-z0-9_-]*)\}\s*$/;

function componentAttrs(entry: ComponentEntry): ComponentAttrs {
  return {
    slug: entry.slug,
    description: entry.description?.trim() ?? '',
    css: entry.css ?? '',
    html: entry.html ?? '',
  };
}

export function componentMapFrom(entries: ComponentEntry[]): Map<string, ComponentAttrs> {
  const map = new Map<string, ComponentAttrs>();
  for (const entry of entries) {
    if (!entry.slug || map.has(entry.slug)) continue;
    if (!COMPONENT_SLUG_PATTERN.test(entry.slug)) continue;
    map.set(entry.slug, componentAttrs(entry));
  }
  return map;
}

export function componentMarkdownItPlugin(
  entries: ComponentEntry[] = [],
): (md: MarkdownIt) => void {
  const components = componentMapFrom(entries);
  return (md: MarkdownIt): void => {
    md.block.ruler.before(
      'paragraph',
      'component',
      (state, startLine, _endLine, silent) => {
        const pos = (state.bMarks[startLine] as number) + (state.tShift[startLine] as number);
        const max = state.eMarks[startLine] as number;
        const line = state.src.slice(pos, max);
        const match = COMPONENT_LINE.exec(line);
        if (!match) return false;
        const slug = match[1];
        if (!slug) return false;
        const attrs = components.get(slug);
        if (!attrs) return false;
        if (silent) return true;
        const token: Token = state.push('component', '', 0);
        token.markup = `{${slug}}`;
        token.block = true;
        token.map = [startLine, startLine + 1];
        token.meta = { attrs };
        state.line = startLine + 1;
        return true;
      },
      { alt: [] },
    );
  };
}

export const componentTokenHandler = {
  node: 'component',
  getAttrs(tok: Token): ComponentAttrs {
    const meta = tok.meta as { attrs?: ComponentAttrs } | null;
    return meta?.attrs ?? EMPTY_COMPONENT_ATTRS;
  },
};

export function componentSerializerNode(state: MarkdownSerializerState, node: ProseNode): void {
  state.write(`{${String(node.attrs.slug ?? '')}}`);
  state.closeBlock(node);
}
