import renderHtml from 'dom-serializer';
import type { ChildNode, DataNode, Element, Text } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import type { ComponentSnippet } from '~/content/model.ts';

// `{slug}` shortcode. The opening `{` and closing `}` are mandatory; the
// inner identifier follows COMPONENT_SLUG_PATTERN (letter first, then
// alphanumeric / underscore / dash). Whitespace is not allowed around the
// slug so we never accidentally consume CSS selectors written in prose
// (`p { color: red }`), and a `{` followed by anything non-slug-shaped is
// left untouched.
const SHORTCODE_PATTERN = /\{([A-Za-z][A-Za-z0-9_-]*)\}/g;

// Elements whose text content is treated as literal — shortcodes inside
// them are decorative or non-applicable and must not be expanded:
//   - <pre> / <code>: source code / examples
//   - <script> / <style>: executable content (also skipped by the parser
//     but listed here for clarity)
//   - <kbd> / <samp> / <var>: keyboard / sample / variable text fragments
const SKIP_ELEMENT_NAMES = new Set(['pre', 'code', 'script', 'style', 'kbd', 'samp', 'var']);

interface ComponentShortcodeResult {
  html: string;
  used: Set<string>;
  missing: Set<string>;
}

export function expandComponentShortcodes(
  html: string,
  components: ReadonlyMap<string, ComponentSnippet>,
): ComponentShortcodeResult {
  const used = new Set<string>();
  const missing = new Set<string>();
  // Fast path: the document is dense HTML, but if it has no `{` at all we
  // can skip the parse/serialize round-trip entirely.
  if (!html.includes('{')) return { html, used, missing };
  const doc = parseDocument(html, {
    decodeEntities: true,
    lowerCaseAttributeNames: false,
  });
  const changed = walk(doc.children, components, used, missing);
  if (!changed) return { html, used, missing };
  const out = renderHtml(doc.children, { decodeEntities: false });
  return { html: out, used, missing };
}

function walk(
  nodes: ChildNode[],
  components: ReadonlyMap<string, ComponentSnippet>,
  used: Set<string>,
  missing: Set<string>,
): boolean {
  let changed = false;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    if (isElement(node)) {
      if (SKIP_ELEMENT_NAMES.has(node.name.toLowerCase())) continue;
      if (walk(node.children, components, used, missing)) changed = true;
      continue;
    }
    if (!isText(node)) continue;
    const text = node.data;
    if (!text.includes('{')) continue;
    const replacement = expandTextNode(text, components, used, missing);
    if (replacement === null) continue;
    // Replace this text node with the expansion's parsed nodes. Inline the
    // children of the produced fragment so we don't introduce a wrapper
    // element where the author had bare text.
    const frag = parseDocument(replacement, { decodeEntities: true });
    nodes.splice(i, 1, ...frag.children);
    relink(nodes);
    // Skip over the inserted nodes — they don't contain unexpanded
    // shortcodes (component HTML is treated as opaque trust).
    i += frag.children.length - 1;
    changed = true;
  }
  return changed;
}

function expandTextNode(
  text: string,
  components: ReadonlyMap<string, ComponentSnippet>,
  used: Set<string>,
  missing: Set<string>,
): string | null {
  let didReplace = false;
  const out = text.replace(SHORTCODE_PATTERN, (match, slug: string) => {
    const component = components.get(slug);
    if (!component) {
      missing.add(slug);
      return match;
    }
    used.add(slug);
    didReplace = true;
    return component.html;
  });
  return didReplace ? out : null;
}

function isElement(node: ChildNode): node is Element {
  return 'attribs' in node && 'children' in node;
}

function isText(node: ChildNode): node is Text {
  return node.type === 'text' && 'data' in node;
}

function relink(nodes: ChildNode[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as DataNode | Element | undefined;
    if (!node) continue;
    node.prev = nodes[i - 1] ?? null;
    node.next = nodes[i + 1] ?? null;
  }
}
