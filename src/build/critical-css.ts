import postcss, { type ChildNode, type Container, type Root } from 'postcss';

// Static (no-browser) critical-CSS extraction. For each route we inline the
// subset of a linked stylesheet whose selectors reference tokens (tags,
// classes, ids, attributes) actually present in that route's rendered HTML,
// then make the original blocking <link> load asynchronously. This is a
// PurgeCSS-style "used CSS" approximation rather than true above-the-fold
// extraction (which would need a headless browser); the full sheet still loads
// async so anything missed - including JS-added classes - resolves once it
// arrives. The matcher is deliberately conservative: when in doubt it keeps a
// rule, because a false keep only mildly bloats the inline block while a false
// drop causes a flash of unstyled content.

export interface UsedTokens {
  tags: Set<string>;
  classes: Set<string>;
  ids: Set<string>;
  attrs: Set<string>;
}

export interface PreparedStylesheet {
  // Public URL the stylesheet is served at (matches the <link href>), e.g.
  // `/assets/built/screen.9bd40.css`. Used both to match the link tag and to
  // resolve relative url() references during extraction.
  publicUrl: string;
  root: Root;
}

const ALWAYS_KEEP_TAGS = new Set(['html', 'body', ':root', '*', 'from', 'to']);

// Parse a stylesheet once per build; the resulting Root is shared read-only
// across all routes (extraction clones nodes before mutating them).
export function prepareStylesheet(opts: {
  cssText: string;
  publicUrl: string;
}): PreparedStylesheet {
  return { publicUrl: opts.publicUrl, root: postcss.parse(opts.cssText) };
}

// Collect the identifiers a stylesheet could key off of from rendered HTML.
export function extractUsedTokens(html: string): UsedTokens {
  const tags = new Set<string>();
  const classes = new Set<string>();
  const ids = new Set<string>();
  const attrs = new Set<string>();

  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null = tagRe.exec(html);
  while (m !== null) {
    tags.add((m[1] ?? '').toLowerCase());
    const attrChunk = m[2] ?? '';
    const attrRe =
      /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a: RegExpExecArray | null = attrRe.exec(attrChunk);
    while (a !== null) {
      const name = (a[1] ?? '').toLowerCase();
      attrs.add(name);
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (name === 'class') {
        for (const cls of value.split(/\s+/)) if (cls) classes.add(cls);
      } else if (name === 'id' && value) {
        ids.add(value);
      }
      a = attrRe.exec(attrChunk);
    }
    m = tagRe.exec(html);
  }
  return { tags, classes, ids, attrs };
}

// Extract the critical subset of a prepared stylesheet for one route's tokens,
// with relative url() references rewritten to absolute (resolved against the
// stylesheet's own URL) so the inlined CSS still points at the right fonts and
// images. Returns '' when nothing matches.
export function extractCriticalCss(
  prepared: PreparedStylesheet,
  used: UsedTokens,
  opts?: { safelist?: readonly RegExp[] },
): string {
  const baseDir = stylesheetBaseDir(prepared.publicUrl);
  const safelist = opts?.safelist ?? [];
  const collected = collectCritical(prepared.root, used, safelist);
  if (!collected) return '';
  // Re-parse the collected subset once to rewrite url() in a single pass.
  const subset = postcss.parse(collected);
  subset.walkDecls((decl) => {
    if (decl.value.includes('url(')) decl.value = absolutizeUrls(decl.value, baseDir);
  });
  return subset.toString().trim();
}

function collectCritical(
  container: Container,
  used: UsedTokens,
  safelist: readonly RegExp[],
): string {
  let out = '';
  container.each((node: ChildNode) => {
    if (node.type === 'rule') {
      if (ruleMatches(node.selector, used, safelist)) out += `${node.toString()}\n`;
      return;
    }
    if (node.type === 'atrule') {
      const name = node.name.toLowerCase().replace(/^-\w+-/, '');
      if (name === 'font-face' || name === 'keyframes' || name === 'page') {
        out += `${node.toString()}\n`;
        return;
      }
      if (node.nodes) {
        const inner = collectCritical(node, used, safelist);
        if (inner.trim()) out += `@${node.name} ${node.params}{${inner}}\n`;
        return;
      }
      // Bodyless at-rules: @charset / @import / @namespace must survive to keep
      // the inlined CSS valid and self-contained.
      out += `${node.toString()}\n`;
    }
  });
  return out;
}

// A rule survives if ANY of its comma-separated selectors matches the route.
function ruleMatches(selectorList: string, used: UsedTokens, safelist: readonly RegExp[]): boolean {
  for (const re of safelist) {
    if (re.test(selectorList)) return true;
  }
  for (const selector of splitSelectorList(selectorList)) {
    if (selectorMatches(selector, used)) return true;
  }
  return false;
}

function selectorMatches(selector: string, used: UsedTokens): boolean {
  // Strip pseudo-classes/elements and functional pseudos (:not(...), :is(...))
  // so matching keys only off concrete tags/classes/ids/attrs. Stripping the
  // functional pseudos' contents biases toward keeping the rule.
  const stripped = selector.replace(/::?[a-zA-Z-]+\([^)]*\)/g, ' ').replace(/::?[a-zA-Z-]+/g, ' ');

  const classMatches = [...stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1] ?? '');
  for (const cls of classMatches) if (!used.classes.has(cls)) return false;

  const idMatches = [...stripped.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1] ?? '');
  for (const id of idMatches) if (!used.ids.has(id)) return false;

  const attrMatches = [...stripped.matchAll(/\[\s*([_a-zA-Z][\w-]*)/g)].map((x) => x[1] ?? '');
  for (const attr of attrMatches) if (!used.attrs.has(attr.toLowerCase())) return false;

  // Tag names: the bare identifiers left once classes/ids/attrs are removed.
  const tagSource = stripped
    .replace(/\.[\w-]+/g, ' ')
    .replace(/#[\w-]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ');
  const tagMatches = [...tagSource.matchAll(/(^|[\s>+~(])([a-zA-Z][a-zA-Z0-9-]*)/g)].map((x) =>
    (x[2] ?? '').toLowerCase(),
  );
  for (const tag of tagMatches) {
    if (ALWAYS_KEEP_TAGS.has(tag)) continue;
    if (!used.tags.has(tag)) return false;
  }
  return true;
}

function splitSelectorList(selectorList: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of selectorList) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function stylesheetBaseDir(publicUrl: string): string {
  const path = publicUrl.split(/[?#]/)[0] ?? '';
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '/';
}

// Resolve relative url(...) targets against the stylesheet's directory. Leaves
// absolute (/...), protocol (https:, data:), and protocol-relative (//) URLs
// untouched.
function absolutizeUrls(value: string, baseDir: string): string {
  return value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote: string, ref: string) => {
    const trimmed = ref.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('data:') ||
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ) {
      return match;
    }
    return `url(${quote}${resolveRelative(baseDir, trimmed)}${quote})`;
  });
}

function resolveRelative(baseDir: string, ref: string): string {
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of ref.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return `/${stack.join('/')}`;
}

export interface CriticalCssContext {
  // Prepared stylesheets keyed by their fingerprinted basename (e.g.
  // `screen.9bd40.css`), which is how we match a <link href> back to its
  // parsed source regardless of base-path prefixing.
  sheets: Map<string, PreparedStylesheet>;
  safelist: readonly RegExp[];
  maxInlineBytes: number;
  nonce?: string;
}

// Inline each route's critical CSS and make the matching blocking stylesheet
// load asynchronously. Idempotent and conservative: links we can't match, that
// are already non-blocking, or whose extracted critical CSS would exceed
// `maxInlineBytes` are left untouched (still render-blocking, never broken).
export function applyCriticalCss(html: string, ctx: CriticalCssContext): string {
  if (ctx.sheets.size === 0 || !html.includes('<link')) return html;
  let used: UsedTokens | undefined;
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!isStylesheetLink(tag)) return tag;
    const href = getAttr(tag, 'href');
    if (!href) return tag;
    const sheet = ctx.sheets.get(basename(href));
    if (!sheet) return tag;
    // Already non-render-blocking (media-swapped or print-only): nothing to do.
    const media = getAttr(tag, 'media')?.trim().toLowerCase();
    if (media && media !== 'all' && media !== 'screen') return tag;

    used ??= extractUsedTokens(html);
    const critical = extractCriticalCss(sheet, used, { safelist: ctx.safelist });
    if (critical === '' || Buffer.byteLength(critical, 'utf8') > ctx.maxInlineBytes) return tag;

    const nonceAttr = ctx.nonce ? ` nonce="${ctx.nonce}"` : '';
    const styleBlock = `<style${nonceAttr}>${critical}</style>`;
    const asyncLink = injectAsyncAttrs(tag);
    const noscript = `<noscript>${tag}</noscript>`;
    return `${styleBlock}${asyncLink}${noscript}`;
  });
}

function injectAsyncAttrs(tag: string): string {
  // media="print" makes the fetch non-render-blocking; the onload handler flips
  // it back to all once parsed. Drop any existing media first.
  const withoutMedia = tag.replace(/\s+media\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, '');
  return withoutMedia.replace(/\s*\/?>$/, ` media="print" onload="this.media='all'">`);
}

function isStylesheetLink(tag: string): boolean {
  const rel = getAttr(tag, 'rel');
  return !!rel && rel.toLowerCase().split(/\s+/).includes('stylesheet');
}

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i');
  const m = tag.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

function basename(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}
