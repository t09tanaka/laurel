import renderHtml from 'dom-serializer';
import { type ChildNode, type Element, Text } from 'domhandler';
import { parseDocument } from 'htmlparser2';

type KoenigLabelTranslator = (key: string) => string;

export function localizeKoenigCardLabels(html: string, translate: KoenigLabelTranslator): string {
  if (!hasKoenigI18nMarker(html)) return html;
  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const changed = localizeNodes(doc.children, translate);
  return changed ? renderHtml(doc.children, { decodeEntities: false }) : html;
}

function localizeNodes(nodes: ChildNode[], translate: KoenigLabelTranslator): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    changed = localizeElement(node, translate) || changed;
    changed = localizeNodes(node.children, translate) || changed;
  }
  return changed;
}

function localizeElement(element: Element, translate: KoenigLabelTranslator): boolean {
  let changed = false;
  const labelKey = element.attribs['data-kg-i18n'];
  if (labelKey) {
    const label = translate(labelKey);
    element.children = [new Text(label)];
    changed = true;
  }

  const placeholderKey = element.attribs['data-kg-i18n-placeholder'];
  if (placeholderKey) {
    element.attribs.placeholder = translate(placeholderKey);
    changed = true;
  }

  for (const attr of ['data-label-copy', 'data-label-copied']) {
    const key = element.attribs[attr];
    if (!key) continue;
    element.attribs[attr] = translate(key);
    changed = true;
  }

  return changed;
}

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function hasKoenigI18nMarker(html: string): boolean {
  return (
    html.includes('data-kg-i18n') ||
    html.includes('data-kg-i18n-placeholder') ||
    html.includes('data-label-copy') ||
    html.includes('data-label-copied')
  );
}
