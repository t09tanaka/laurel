// Helpers for rewriting `{slug}` component shortcode references in
// markdown bodies — the post / page side of the component rename flow.
//
// The renderer's expander (src/render/component-shortcodes.ts) walks
// the rendered DOM and skips text inside `<pre>`, `<code>`, `<kbd>`,
// `<samp>`, `<var>`, `<script>`, `<style>` so `{slug}` in those
// contexts stays literal. This rewriter operates on raw markdown
// instead, so it has to apply the same skip rules at the markdown
// level: fenced code blocks (``` and ~~~) and inline code spans (`...`).
// Anything else — paragraphs, list items, blockquotes, table cells,
// HTML blocks — is fair game.

const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;

interface RewriteResult {
  body: string;
  count: number;
}

// Replace every plain-text `{oldSlug}` occurrence with `{newSlug}`,
// respecting markdown code regions. Returns the new body and the
// number of replacements made (0 → no write needed).
//
// `oldSlug` and `newSlug` are inserted verbatim — callers are expected
// to validate them against COMPONENT_SLUG_PATTERN before calling, so
// the function trusts its inputs and doesn't escape regex
// metacharacters (the slug pattern can't contain any).
export function rewriteComponentSlugInBody(
  body: string,
  oldSlug: string,
  newSlug: string,
): RewriteResult {
  const needle = `{${oldSlug}}`;
  if (!body.includes(needle)) return { body, count: 0 };
  if (oldSlug === newSlug) return { body, count: 0 };
  const replacement = `{${newSlug}}`;

  const lines = body.split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fenceMatch = line.match(FENCE_OPEN);
    if (fenceMatch) {
      const marker = fenceMatch[2] ?? '';
      const head = marker[0] ?? '';
      if (!inFence) {
        // Opening fence — language tag may follow, but we don't care.
        inFence = true;
        fenceChar = head;
        fenceLen = marker.length;
        continue;
      }
      // Closing fence must match the opener's char and be at least as
      // long (CommonMark rule). The closing line has no info string,
      // so reject if there's trailing non-whitespace after the marker.
      const trailing = (fenceMatch[3] ?? '').trim();
      if (head === fenceChar && marker.length >= fenceLen && trailing === '') {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        continue;
      }
      // Otherwise it's content inside the fence (e.g. nested fence-
      // looking text). Fall through to skip rewriting.
    }
    if (inFence) continue;

    const rewritten = rewriteLineRespectingInlineCode(line, needle, replacement);
    if (rewritten.count > 0) {
      lines[i] = rewritten.line;
      count += rewritten.count;
    }
  }

  return { body: lines.join('\n'), count };
}

// Walks one line, skipping over inline code spans (` … ` / `` … `` /
// ``` … ``` etc.) and replacing `needle` outside them. Mirrors the
// CommonMark rule: an opener of N backticks closes against the next
// run of exactly N backticks. Unbalanced opens are treated as literal
// text — the rewriter still applies to the rest of the line.
function rewriteLineRespectingInlineCode(
  line: string,
  needle: string,
  replacement: string,
): { line: string; count: number } {
  if (!line.includes(needle)) return { line, count: 0 };
  let out = '';
  let i = 0;
  let count = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let openLen = 0;
      while (i + openLen < line.length && line[i + openLen] === '`') openLen += 1;
      const close = findMatchingBackticks(line, i + openLen, openLen);
      if (close !== -1) {
        out += line.slice(i, close + openLen);
        i = close + openLen;
        continue;
      }
      // No matching close → emit the run as literal and resume from
      // just after it. The rest of the line is still scanned.
      out += line.slice(i, i + openLen);
      i += openLen;
      continue;
    }
    if (line.startsWith(needle, i)) {
      out += replacement;
      i += needle.length;
      count += 1;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return { line: out, count };
}

// Locate the next run of exactly `len` backticks starting at or after
// `from`. CommonMark requires the closer to match the opener's
// length; backtick runs of a different length are part of the code
// span's content.
function findMatchingBackticks(line: string, from: number, len: number): number {
  let i = from;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (i + run < line.length && line[i + run] === '`') run += 1;
    if (run === len) return i;
    i += run;
  }
  return -1;
}

// Split a raw markdown file into `(frontmatter, body)` preserving the
// frontmatter section byte-for-byte. Returns an empty frontmatter
// string when the file has none. Unlike `parseFrontmatter`, this
// keeps trailing whitespace / newlines exactly so writes round-trip
// without normalising the file's existing format.
export function splitFrontmatterRaw(raw: string): { frontmatter: string; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: '', body: raw };
  // Must be a proper YAML fence: `---` followed by newline.
  if (raw[3] !== '\n' && !(raw[3] === '\r' && raw[4] === '\n')) {
    return { frontmatter: '', body: raw };
  }
  // Find the closing `---` at the start of a subsequent line. Pattern:
  // `\n---` followed by end-of-line (or end-of-file). Avoids matching
  // a stray `---` mid-paragraph.
  const closing = raw.match(/\r?\n---(?:\r?\n|$)/);
  if (!closing || closing.index === undefined) return { frontmatter: '', body: raw };
  const end = closing.index + closing[0].length;
  return { frontmatter: raw.slice(0, end), body: raw.slice(end) };
}
