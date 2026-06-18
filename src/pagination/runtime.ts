// Paginated-feed progressive-enhancement runtime.
//
// Ghost themes render an infinite-scrolling feed by wiring theme JS to Ghost's
// runtime. Laurel is static, so that wiring is gone after a build. This shim
// re-creates the experience as pure progressive enhancement on top of the
// `/page/N/` pagination links Laurel already emits: it follows the absolute
// `rel="next"` URL in the document, fetches that page, lifts the post cards out
// of it, and appends them to the live feed — either automatically as the reader
// nears the end (`infinite`) or behind a button (`load-more`).
//
// With JS disabled, or when `fetch` / `IntersectionObserver` are unavailable,
// nothing runs and the classic pagination links remain the navigation path.
// Sub-path deploys (`/blog/`) work because the runtime resolves the next URL
// from the emitted `rel="next"` (an absolute URL that already carries the base
// path) rather than reconstructing the `/page/N/` scheme.
//
// Shipped as a string constant — like the search shim — so the build pipeline
// writes it verbatim with no bundler step. The emitted JS uses no imports.

type PaginationMode = 'infinite' | 'load-more';

interface PaginationEnhanceOptions {
  mode: PaginationMode;
  containerSelector: string;
  itemSelector: string;
  // Localized label for the load-more button. Defaults to "Load more".
  loadMoreLabel?: string;
}

export function renderPaginationEnhanceShim(opts: PaginationEnhanceOptions): string {
  const mode = JSON.stringify(opts.mode);
  const containerSelector = JSON.stringify(opts.containerSelector);
  const itemSelector = JSON.stringify(opts.itemSelector);
  const loadMoreLabel = JSON.stringify(opts.loadMoreLabel ?? 'Load more');
  return `// Laurel pagination enhancement runtime. Auto-generated; do not edit by hand.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__laurelPaginationEnhanceLoaded) return;
  window.__laurelPaginationEnhanceLoaded = true;
  if (typeof window.fetch !== 'function' || typeof window.DOMParser !== 'function') return;

  var MODE = ${mode};
  var CONTAINER_SELECTOR = ${containerSelector};
  var ITEM_SELECTOR = ${itemSelector};
  var LOAD_MORE_LABEL = ${loadMoreLabel};

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // Resolve the next-page URL from a document. Prefers the canonical
  // <link rel="next"> (an absolute URL carrying the base path), then falls back
  // to common pagination anchors. Always resolved against the live page URL so
  // a relative href from a parsed (DOMParser) document — which has no base —
  // still becomes absolute.
  function nextUrlFrom(doc) {
    var candidates = [
      doc.querySelector('link[rel="next"]'),
      doc.querySelector('a[rel="next"]'),
      doc.querySelector('.pagination .older-posts'),
      doc.querySelector('.older-posts'),
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var href = el && el.getAttribute('href');
      if (href) {
        try {
          return new URL(href, window.location.href).href;
        } catch (e) {
          /* malformed href; try the next candidate */
        }
      }
    }
    return null;
  }

  ready(function () {
    var container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    var nextUrl = nextUrlFrom(document);
    if (!nextUrl) return;

    var loading = false;
    var done = false;
    var sentinel = null;
    var observer = null;
    var button = null;

    // Hide the now-redundant pagination nav once enhancement is active. Left in
    // the DOM for no-JS fallback; only hidden when the runtime takes over.
    var nav = document.querySelector('.pagination');
    if (nav) nav.setAttribute('hidden', '');

    function finish() {
      done = true;
      if (observer) observer.disconnect();
      if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
      if (button && button.parentNode) button.parentNode.removeChild(button);
    }

    function loadNext() {
      if (loading || done || !nextUrl) return;
      loading = true;
      if (button) button.disabled = true;
      var url = nextUrl;
      window
        .fetch(url, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          var doc = new window.DOMParser().parseFromString(text, 'text/html');
          var fetchedContainer = doc.querySelector(CONTAINER_SELECTOR);
          var items = fetchedContainer
            ? fetchedContainer.querySelectorAll(ITEM_SELECTOR)
            : doc.querySelectorAll(CONTAINER_SELECTOR + ' ' + ITEM_SELECTOR);
          for (var i = 0; i < items.length; i++) {
            container.appendChild(document.importNode(items[i], true));
          }
          nextUrl = nextUrlFrom(doc);
          loading = false;
          if (button) button.disabled = false;
          if (!nextUrl) {
            finish();
          } else if (MODE === 'infinite' && observer && sentinel) {
            // Re-observe in case the sentinel left the viewport during the load.
            observer.observe(sentinel);
          }
        })
        .catch(function () {
          // Leave the original pagination links as the fallback path.
          loading = false;
          if (nav) nav.removeAttribute('hidden');
          finish();
        });
    }

    if (MODE === 'load-more') {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'laurel-load-more';
      button.setAttribute('data-laurel-load-more', '');
      button.textContent = LOAD_MORE_LABEL;
      button.addEventListener('click', loadNext);
      if (container.parentNode) {
        container.parentNode.insertBefore(button, container.nextSibling);
      } else {
        container.appendChild(button);
      }
      return;
    }

    // Infinite scroll. Without IntersectionObserver, restore the pagination nav
    // and bail so the static links keep working.
    if (typeof window.IntersectionObserver !== 'function') {
      if (nav) nav.removeAttribute('hidden');
      return;
    }
    sentinel = document.createElement('div');
    sentinel.className = 'laurel-infinite-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    if (container.parentNode) {
      container.parentNode.insertBefore(sentinel, container.nextSibling);
    } else {
      container.appendChild(sentinel);
    }
    observer = new window.IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            loadNext();
            break;
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
  });
})();
`;
}
