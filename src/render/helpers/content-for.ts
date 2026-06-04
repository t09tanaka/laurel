import type Handlebars from 'handlebars';
import type { LaurelEngine } from '../engine.ts';

// Ghost's `{{#contentFor "name"}}…{{/contentFor}}` + `{{{block "name"}}}` pair
// is the canonical way for a child template (rendered first) to inject markup
// into a slot owned by its layout (rendered second). Handlebars has no native
// "block region" concept, so we implement it as paired helpers that share a
// per-render mutable buffer carried on the data frame under `__blocks`.
//
// The engine sets up `data.__blocks = {}` before rendering the inner template,
// passes that same frame to the layout, and the `block` helper there reads
// whatever the inner accumulated. SafeString is used so HTML the child built
// is not re-escaped when the layout outputs `{{{block "head"}}}`.
//
// Multiple `contentFor "x"` blocks in the same render concatenate (Ghost
// behaviour), so a child can call `contentFor "scripts"` from several spots
// and the layout sees the joined output. `block` without a matching
// `contentFor` is empty (not a hard error) so themes can declare optional
// slots that most pages don't fill.

interface BlocksData {
  __blocks?: Record<string, string>;
}

export function registerContentForHelpers(engine: LaurelEngine): void {
  engine.hb.registerHelper(
    'contentFor',
    function contentForHelper(this: unknown, name: unknown, options: Handlebars.HelperOptions) {
      const slot = typeof name === 'string' ? name : '';
      if (!slot) return '';
      const data = (options.data ?? {}) as BlocksData;
      // The engine seeds `__blocks` per render; guard against direct callers
      // (tests) that forgot to wire it up so the helper degrades to no-op
      // rather than throwing.
      let blocks = data.__blocks;
      if (!blocks) {
        blocks = {};
        data.__blocks = blocks;
      }
      const rendered = options.fn(this, { data: options.data });
      blocks[slot] = (blocks[slot] ?? '') + rendered;
      return '';
    },
  );

  engine.hb.registerHelper(
    'block',
    function blockHelper(this: unknown, name: unknown, options: Handlebars.HelperOptions) {
      const slot = typeof name === 'string' ? name : '';
      if (!slot) return '';
      const data = (options.data ?? {}) as BlocksData;
      const value = data.__blocks?.[slot] ?? '';
      return new engine.hb.SafeString(value);
    },
  );
}
