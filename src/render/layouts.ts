import { posix as path } from 'node:path';

const LAYOUT_DIRECTIVE = /^\s*\{\{!<\s*([^}\s]+)\s*\}\}\s*/;
const HANDLEBARS_BLOCK_COMMENT_OPEN = '{{!--';
const HANDLEBARS_BLOCK_COMMENT_CLOSE = '--}}';

interface LayoutSplit {
  layout: string | undefined;
  body: string;
}

export function splitLayout(template: string): LayoutSplit {
  const preambleEnd = findLayoutPreambleEnd(template);
  const candidate = template.slice(preambleEnd);
  const match = candidate.match(LAYOUT_DIRECTIVE);
  if (!match || match.index === undefined) {
    return { layout: undefined, body: template };
  }
  const layout = match[1];
  const body = template.slice(preambleEnd + match.index + match[0].length);
  return { layout, body };
}

function findLayoutPreambleEnd(template: string): number {
  let index = 0;

  while (index < template.length) {
    const nextIndex = skipLayoutPreambleToken(template, index);
    if (nextIndex === index) {
      return index;
    }
    index = nextIndex;
  }

  return index;
}

function skipLayoutPreambleToken(template: string, index: number): number {
  const whitespaceMatch = template.slice(index).match(/^[\s\uFEFF]+/);
  if (whitespaceMatch) {
    return index + whitespaceMatch[0].length;
  }

  if (!template.startsWith(HANDLEBARS_BLOCK_COMMENT_OPEN, index)) {
    return index;
  }

  const commentCloseIndex = template.indexOf(
    HANDLEBARS_BLOCK_COMMENT_CLOSE,
    index + HANDLEBARS_BLOCK_COMMENT_OPEN.length,
  );
  if (commentCloseIndex === -1) {
    return index;
  }

  return commentCloseIndex + HANDLEBARS_BLOCK_COMMENT_CLOSE.length;
}

export function resolveLayoutName(layout: string, templateName: string): string {
  const normalizedLayout = layout.replaceAll('\\', '/');
  if (!normalizedLayout.startsWith('.')) {
    return path.normalize(normalizedLayout);
  }
  const templateDir = path.dirname(templateName.replaceAll('\\', '/'));
  return path.normalize(path.join(templateDir, normalizedLayout));
}
