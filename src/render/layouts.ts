const LAYOUT_DIRECTIVE = /^\s*\{\{!<\s*([\w-]+)\s*\}\}\s*/;

export interface LayoutSplit {
  layout: string | undefined;
  body: string;
}

export function splitLayout(template: string): LayoutSplit {
  const match = template.match(LAYOUT_DIRECTIVE);
  if (!match || match.index === undefined) {
    return { layout: undefined, body: template };
  }
  const layout = match[1];
  const body = template.slice(match.index + match[0].length);
  return { layout, body };
}
