export function computeWarnings(body: string): string[] {
  const markdownEmptyAltLines: number[] = [];
  const htmlMissingAltLines: number[] = [];
  let fenceMarker: string | null = null;

  const lines = body.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? '';
      if (fenceMarker === marker) {
        fenceMarker = null;
      } else if (!fenceMarker) {
        fenceMarker = marker;
      }
      continue;
    }
    if (fenceMarker) continue;

    if (/!\[\s*\]\([^)]*\)/.test(line)) markdownEmptyAltLines.push(lineNumber);
    if (/<img\b(?![^>]*\salt\s*=)[^>]*>/i.test(line)) htmlMissingAltLines.push(lineNumber);
  }

  const warnings: string[] = [];
  if (markdownEmptyAltLines.length > 0) {
    warnings.push(
      `Markdown image${markdownEmptyAltLines.length === 1 ? ' has' : 's have'} empty alt text at ${formatLineList(markdownEmptyAltLines)}.`,
    );
  }
  if (htmlMissingAltLines.length > 0) {
    warnings.push(
      `HTML image${htmlMissingAltLines.length === 1 ? ' is' : 's are'} missing an alt attribute at ${formatLineList(htmlMissingAltLines)}.`,
    );
  }
  return warnings;
}

function formatLineList(lines: number[]): string {
  const unique = [...new Set(lines)];
  const visible = unique.slice(0, 5);
  const suffix = unique.length > visible.length ? `, +${unique.length - visible.length} more` : '';
  return `${visible.length === 1 ? 'line' : 'lines'} ${visible.join(', ')}${suffix}`;
}
