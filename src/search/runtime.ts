// Pagefind runtime shim.
//
// This is a tiny JS module emitted to `dist/search/ghost-search.js` when
// `[components.search].enabled = true` and the search engine includes
// `pagefind`. Themes built for Ghost expose `[data-ghost-search]` triggers
// (search buttons / inputs); Ghost itself hands those off to a Members /
// Sodo Search bundle that Nectar does not ship. The shim plugs the same
// triggers into Pagefind so Ghost themes get a working search modal out of
// the box without theme edits.
//
// The shim:
//   1. Finds every `[data-ghost-search]` element on the page.
//   2. Adds a click listener that opens a Pagefind modal.
//   3. Listens for cmd+K / ctrl+K to open the same modal.
//   4. Lazy-loads `/pagefind/pagefind-ui.js` (relative to `base_path`) only
//      on first activation so cold-page loads stay cheap.
//
// We ship this as a string constant rather than a separate `.js` source so
// the build pipeline can copy it verbatim without a bundler step. The shim
// uses no imports and degrades gracefully if Pagefind failed to emit (e.g.
// the `pagefind` binary is missing in CI): a warning is logged to the
// console and the click is a no-op so the page doesn't visibly break.

export interface SearchShimOptions {
  // Base path prefix applied to absolute URLs the shim resolves (e.g. the
  // Pagefind UI bundle). Defaults to "/". Pulled from `[build].base_path`.
  basePath?: string;
}

// Normalize a base path the same way `[build].base_path` is normalized:
// leading slash, trailing slash, no double slashes. Kept inline (instead of
// imported) so the emitted JS is fully self-contained.
function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

// Emit the runtime shim as a string of JavaScript. The build pipeline writes
// this to `dist/search/ghost-search.js`. We splice the resolved base path
// into the URL so the shim works under sub-directory deploys.
export function renderSearchShim(opts: SearchShimOptions = {}): string {
  const basePath = normalizeBasePath(opts.basePath ?? '/');
  const pagefindUrl = `${basePath}pagefind/pagefind-ui.js`;
  const pagefindCss = `${basePath}pagefind/pagefind-ui.css`;
  // Use a JSON-stringified URL so paths with characters needing escaping
  // (unlikely under base_path but defense-in-depth) stay safe inside the
  // emitted JS.
  return `// Nectar search runtime shim. Auto-generated; do not edit by hand.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__nectarSearchShimLoaded) return;
  window.__nectarSearchShimLoaded = true;

  var PAGEFIND_UI_URL = ${JSON.stringify(pagefindUrl)};
  var PAGEFIND_CSS_URL = ${JSON.stringify(pagefindCss)};
  var MODAL_ID = 'nectar-search-modal';
  var uiPromise = null;

  function ensureCss() {
    if (document.querySelector('link[data-nectar-search-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = PAGEFIND_CSS_URL;
    link.setAttribute('data-nectar-search-css', '');
    document.head.appendChild(link);
  }

  function loadPagefindUI() {
    if (uiPromise) return uiPromise;
    ensureCss();
    uiPromise = import(/* @vite-ignore */ PAGEFIND_UI_URL).catch(function (err) {
      uiPromise = null;
      console.warn('[nectar-search] Failed to load Pagefind UI from ' + PAGEFIND_UI_URL + '. Did the build run with engine = "pagefind" or "json+pagefind"?', err);
      throw err;
    });
    return uiPromise;
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Search');
    modal.setAttribute('hidden', '');
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '99999';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'flex-start';
    modal.style.justifyContent = 'center';
    modal.style.padding = '10vh 1rem 1rem';

    var inner = document.createElement('div');
    inner.style.background = '#fff';
    inner.style.color = '#111';
    inner.style.width = '100%';
    inner.style.maxWidth = '640px';
    inner.style.borderRadius = '8px';
    inner.style.padding = '1rem';
    inner.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)';

    var mount = document.createElement('div');
    mount.id = MODAL_ID + '-mount';
    inner.appendChild(mount);
    modal.appendChild(inner);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function openModal() {
    var modal = ensureModal();
    modal.removeAttribute('hidden');
    loadPagefindUI().then(function (mod) {
      var PagefindUI = (mod && mod.PagefindUI) || (window.PagefindUI);
      if (!PagefindUI) {
        console.warn('[nectar-search] PagefindUI constructor not found on import.');
        return;
      }
      var mount = document.getElementById(MODAL_ID + '-mount');
      if (!mount) return;
      if (mount.getAttribute('data-initialized') === 'true') return;
      mount.setAttribute('data-initialized', 'true');
      // eslint-disable-next-line no-new
      new PagefindUI({ element: '#' + MODAL_ID + '-mount', showSubResults: true });
      var input = mount.querySelector('input');
      if (input) input.focus();
    }).catch(function () {
      // already logged; leave modal open so users see something is wrong
    });
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.setAttribute('hidden', '');
  }

  function onKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openModal();
      return;
    }
    if (e.key === 'Escape') {
      var modal = document.getElementById(MODAL_ID);
      if (modal && !modal.hasAttribute('hidden')) {
        e.preventDefault();
        closeModal();
      }
    }
  }

  function wireTriggers() {
    var triggers = document.querySelectorAll('[data-ghost-search]');
    for (var i = 0; i < triggers.length; i++) {
      var el = triggers[i];
      if (el.getAttribute('data-nectar-search-wired') === 'true') continue;
      el.setAttribute('data-nectar-search-wired', 'true');
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    }
  }

  function init() {
    wireTriggers();
    document.addEventListener('keydown', onKeydown);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}
