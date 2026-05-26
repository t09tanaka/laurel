// Rewrite an active theme's `screen.css` so it can be loaded inside the
// dashboard without bleeding into dashboard chrome. The dashboard is
// rendered by our own React/Preact app, but the bookmark NodeView paints
// a Ghost-compatible DOM (`<figure class="kg-card kg-bookmark-card">…`)
// wrapped in a `<div class="proseBookmarkScope">` so we can borrow the
// theme's `.kg-bookmark-*` styling for in-editor preview parity.
//
// Naive prefixing breaks the theme because Ghost-style themes ship
// universal resets (`*`), root variable declarations (`:root { … }`) and
// document-level rules (`html`, `body`). Those rules would clobber the
// dashboard if we just prepended `.proseBookmarkScope` to every
// selector. The transform below maps them onto the scope wrapper
// instead of the document root.

import postcss from 'postcss';
import prefixer from 'postcss-prefix-selector';

export const THEME_SCOPE_CLASS = 'proseBookmarkScope';

export interface RewriteThemeCssOptions {
  scope?: string;
}

// Selectors that target the document root or every element. We rewrite
// them onto the scope itself so the theme's resets and CSS variables
// apply *inside* the scope element instead of leaking up to <html> /
// <body> / the entire page.
const ROOT_SELECTORS = new Set(['html', 'body', ':root']);

export function rewriteThemeCss(source: string, options: RewriteThemeCssOptions = {}): string {
  const scope = options.scope ?? THEME_SCOPE_CLASS;
  const scopeSelector = `.${scope}`;
  const plugin = prefixer({
    prefix: scopeSelector,
    transform(_prefix, selector, prefixedSelector) {
      const trimmed = selector.trim();
      if (ROOT_SELECTORS.has(trimmed)) return scopeSelector;
      // Match `:root.has-light-text`, `:root[data-x]`, `html.dark` etc:
      // attach the scope to the modifier instead of nesting.
      const rootWithModifier = trimmed.match(/^(?::root|html|body)([.:[#].*)$/);
      if (rootWithModifier) return `${scopeSelector}${rootWithModifier[1]}`;
      // `*` is a per-element reset — keep its semantics but scope it.
      if (trimmed === '*') return `${scopeSelector} *`;
      // Bare pseudo-elements (`:after` / `:before` in CSS2 form, or
      // their `::` variants) come from the common `*,:after,:before`
      // reset triple. postcss-prefix-selector hands each selector to
      // us individually after splitting on commas, so we map them back
      // onto descendants of the scope rather than the scope itself.
      if (trimmed === ':after' || trimmed === '::after') return `${scopeSelector} *::after`;
      if (trimmed === ':before' || trimmed === '::before') return `${scopeSelector} *::before`;
      return prefixedSelector;
    },
  });
  const result = postcss([plugin]).process(source, { from: undefined });
  return result.css;
}
