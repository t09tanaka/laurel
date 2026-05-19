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
  search: `<form class="nectar-search" role="search" data-nectar-search-root onsubmit="return false">
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
`,
};
