// Built-in partial sources that every theme gets registered automatically.
// Themes can override any entry by shipping a `partials/<name>.hbs` of their
// own — `registerPartials` re-registers under the same key after the defaults
// are installed, so theme partials win on collision.
//
// Keep these strictly scoped to features Nectar ships an opinionated default
// for (search UI, etc.). Layout/typography concerns belong in the theme.

export const DEFAULT_PARTIALS: Record<string, string> = {
  // Default search widget markup. Pairs with the vanilla widget emitted by
  // `emitLunrWidget` (or any other engine that wires `[data-nectar-search]` +
  // `[data-nectar-search-results]`) and the starter stylesheet emitted by
  // `emitSearchUiCss` at `search/search.css`. Themes that prefer their own
  // markup can drop `partials/search.hbs` in the theme and override this
  // wholesale.
  search: `<search class="nectar-search" data-nectar-search-root>
  <form onsubmit="return false">
  <label class="nectar-search__label" for="nectar-search-input">{{t "Search"}}</label>
  <input
    class="nectar-search__input"
    id="nectar-search-input"
    type="search"
    autocomplete="off"
    spellcheck="false"
    placeholder="{{t "Search posts…"}}"
    aria-label="{{t "Search"}}"
    data-nectar-search
  />
  <ul class="nectar-search__results" role="listbox" data-nectar-search-results></ul>
</form>
</search>
`,
  // Default paywall CTA used in place of members-only / paid content that has
  // been truncated at a paywall marker. Themes that want their own copy or
  // layout can drop `partials/paywall.hbs` in their theme and the theme
  // version wins via `registerPartials` (issue #207). The block is rendered
  // both via the loader-injected stub (the `gh-paywall-stub` class kept for
  // backward compatibility with the existing `truncate` policy CSS) and by
  // any theme that calls `{{> paywall}}` directly to compose a richer
  // members landing page.
  paywall: `<aside class="gh-paywall" data-nectar-paywall>
  <p>{{t "Subscribe to read the rest."}}</p>
  <button type="button" data-portal="signup">{{t "Subscribe"}}</button>
</aside>
`,
};
