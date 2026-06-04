// Ghost search trigger runtime shim.
//
// Themes built for Ghost expose `[data-ghost-search]` triggers (search buttons
// / inputs). Ghost itself wires those to Sodo Search, but Laurel is static and
// does not bundle that runtime by default. This shim gives those triggers a
// working modal by routing them to either:
//   - Pagefind UI, when the configured engine emits a Pagefind index.
//   - Laurel's flat `content/search.json`, for the default JSON search index.
//   - Laurel's pre-built `search-index.json`, for the Lunr search index.
//
// We ship this as a string constant rather than a separate `.js` source so the
// build pipeline can write it verbatim without a bundler step. The emitted JS
// uses no imports except the lazy Pagefind import in Pagefind mode.

type SearchShimStrategy = 'json' | 'pagefind' | 'lunr';

interface SearchShimOptions {
  // Base path prefix applied to absolute URLs the shim resolves. Defaults to
  // "/". Pulled from `[build].base_path`.
  basePath?: string;
  strategy?: SearchShimStrategy;
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
// this to `dist/search/ghost-search.js`. We splice the resolved base path into
// runtime URLs so the shim works under sub-directory deploys.
export function renderSearchShim(opts: SearchShimOptions = {}): string {
  const basePath = normalizeBasePath(opts.basePath ?? '/');
  const strategy = opts.strategy ?? 'json';
  const pagefindUrl = `${basePath}pagefind/pagefind-ui.js`;
  const pagefindCss = `${basePath}pagefind/pagefind-ui.css`;
  const searchJsonUrl = `${basePath}content/search.json`;
  const lunrRuntimeUrl = `${basePath}search/lunr.min.js`;
  const lunrIndexUrl = `${basePath}search-index.json`;
  // Use JSON-stringified values so paths with characters needing escaping stay
  // safe inside the emitted JS.
  return `// Laurel search runtime shim. Auto-generated; do not edit by hand.
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__laurelSearchShimLoaded) return;
  window.__laurelSearchShimLoaded = true;

  var SEARCH_MODE = ${JSON.stringify(strategy)};
  var PAGEFIND_UI_URL = ${JSON.stringify(pagefindUrl)};
  var PAGEFIND_CSS_URL = ${JSON.stringify(pagefindCss)};
  var SEARCH_JSON_URL = ${JSON.stringify(searchJsonUrl)};
  var LUNR_RUNTIME_URL = ${JSON.stringify(lunrRuntimeUrl)};
  var LUNR_INDEX_URL = ${JSON.stringify(lunrIndexUrl)};
  var MODAL_ID = 'laurel-search-modal';
  var uiPromise = null;
  var jsonPromise = null;
  var lunrRuntimePromise = null;
  var lunrIndexPromise = null;

  function ensurePagefindCss() {
    if (document.querySelector('link[data-laurel-search-css]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = PAGEFIND_CSS_URL;
    link.setAttribute('data-laurel-search-css', '');
    document.head.appendChild(link);
  }

  function loadPagefindUI() {
    if (uiPromise) return uiPromise;
    ensurePagefindCss();
    uiPromise = import(/* @vite-ignore */ PAGEFIND_UI_URL).catch(function (err) {
      uiPromise = null;
      console.warn('[laurel-search] Failed to load Pagefind UI from ' + PAGEFIND_UI_URL + '. Did the build run with engine = "pagefind" or "json+pagefind"?', err);
      throw err;
    });
    return uiPromise;
  }

  function injectModalStyles() {
    if (document.getElementById(MODAL_ID + '-styles')) return;
    var style = document.createElement('style');
    style.id = MODAL_ID + '-styles';
    style.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;padding:10vh 1rem 1rem;box-sizing:border-box;}',
      '#' + MODAL_ID + '[hidden]{display:none;}',
      '.laurel-search-modal__panel{background:#fff;color:#111;width:100%;max-width:640px;border-radius:8px;padding:1rem;box-shadow:0 20px 60px rgba(0,0,0,.25);box-sizing:border-box;}',
      '.laurel-search-modal__header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.75rem;}',
      '.laurel-search-modal__title{margin:0;font:600 1rem/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.laurel-search-modal__close{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:1.25rem;line-height:1;cursor:pointer;padding:.25rem;}',
      '.laurel-search-modal__input{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:.65rem .75rem;font:inherit;color:#111;background:#fff;}',
      '.laurel-search-modal__input:focus{outline:2px solid #2563eb;outline-offset:2px;}',
      '.laurel-search-modal__status{margin:.75rem 0 0;color:#6b7280;font:400 .875rem/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.laurel-search-modal__results{list-style:none;margin:.75rem 0 0;padding:0;max-height:55vh;overflow:auto;}',
      '.laurel-search-modal__result{border-top:1px solid #e5e7eb;padding:.75rem 0;}',
      '.laurel-search-modal__result a{color:#111;text-decoration:none;font:600 .95rem/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      '.laurel-search-modal__result a:hover{color:#2563eb;}',
      '.laurel-search-modal__result small{display:block;margin-top:.15rem;color:#6b7280;text-transform:capitalize;}',
      '.laurel-search-modal__result p{margin:.25rem 0 0;color:#4b5563;font:400 .875rem/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    injectModalStyles();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Search');
    modal.setAttribute('hidden', '');

    var panel = document.createElement('div');
    panel.className = 'laurel-search-modal__panel';

    var header = document.createElement('div');
    header.className = 'laurel-search-modal__header';
    var title = document.createElement('h2');
    title.className = 'laurel-search-modal__title';
    title.textContent = 'Search';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'laurel-search-modal__close';
    close.setAttribute('aria-label', 'Close search');
    close.textContent = 'x';
    close.addEventListener('click', closeModal);
    header.appendChild(title);
    header.appendChild(close);

    var mount = document.createElement('div');
    mount.id = MODAL_ID + '-mount';
    panel.appendChild(header);
    panel.appendChild(mount);
    modal.appendChild(panel);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function openModal() {
    var modal = ensureModal();
    modal.removeAttribute('hidden');
    if (SEARCH_MODE === 'pagefind') {
      openPagefindModal();
    } else if (SEARCH_MODE === 'lunr') {
      openLunrModal();
    } else {
      openJsonModal();
    }
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.setAttribute('hidden', '');
  }

  function openPagefindModal() {
    loadPagefindUI().then(function (mod) {
      var PagefindUI = (mod && mod.PagefindUI) || window.PagefindUI;
      if (!PagefindUI) {
        console.warn('[laurel-search] PagefindUI constructor not found on import.');
        return;
      }
      var mount = document.getElementById(MODAL_ID + '-mount');
      if (!mount) return;
      if (mount.getAttribute('data-initialized') !== 'true') {
        mount.setAttribute('data-initialized', 'true');
        // eslint-disable-next-line no-new
        new PagefindUI({ element: '#' + MODAL_ID + '-mount', showSubResults: true });
      }
      var input = mount.querySelector('input');
      if (input) input.focus();
    }).catch(function () {
      // already logged; leave modal open so users see something is wrong
    });
  }

  function loadSearchJson() {
    if (jsonPromise) return jsonPromise;
    jsonPromise = fetch(SEARCH_JSON_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('search.json fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        return normalizeEntries(data);
      })
      .catch(function (err) {
        jsonPromise = null;
        console.warn('[laurel-search] Failed to load search index from ' + SEARCH_JSON_URL + '.', err);
        throw err;
      });
    return jsonPromise;
  }

  function loadLunrRuntime() {
    if (typeof window.lunr === 'function') return Promise.resolve(window.lunr);
    if (lunrRuntimePromise) return lunrRuntimePromise;
    lunrRuntimePromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-laurel-lunr-runtime]');
      if (existing) {
        existing.addEventListener('load', function () {
          if (typeof window.lunr === 'function') resolve(window.lunr);
          else reject(new Error('lunr runtime missing on window'));
        }, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = LUNR_RUNTIME_URL;
      script.defer = true;
      script.setAttribute('data-laurel-lunr-runtime', '');
      script.addEventListener('load', function () {
        if (typeof window.lunr === 'function') resolve(window.lunr);
        else reject(new Error('lunr runtime missing on window'));
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    }).catch(function (err) {
      lunrRuntimePromise = null;
      console.warn('[laurel-search] Failed to load Lunr runtime from ' + LUNR_RUNTIME_URL + '.', err);
      throw err;
    });
    return lunrRuntimePromise;
  }

  function loadLunrIndex() {
    if (lunrIndexPromise) return lunrIndexPromise;
    lunrIndexPromise = loadLunrRuntime()
      .then(function (lunr) {
        return fetch(LUNR_INDEX_URL).then(function (r) {
          if (!r.ok) throw new Error('search-index.json fetch failed: ' + r.status);
          return r.json().then(function (data) {
            var docs = Array.isArray(data && data.docs) ? data.docs : [];
            return { index: lunr.Index.load(data.index), docs: docs };
          });
        });
      })
      .catch(function (err) {
        lunrIndexPromise = null;
        console.warn('[laurel-search] Failed to load Lunr search index from ' + LUNR_INDEX_URL + '.', err);
        throw err;
      });
    return lunrIndexPromise;
  }

  function normalizeEntries(data) {
    var entries = [];
    function pushMany(items, kind) {
      if (!Array.isArray(items)) return;
      for (var i = 0; i < items.length; i++) {
        var item = items[i] || {};
        var title = item.title || item.name || item.slug || '';
        var url = item.url || '#';
        entries.push({
          title: String(title),
          url: String(url),
          kind: kind,
          excerpt: item.excerpt ? String(item.excerpt) : '',
          terms: [title, item.excerpt, item.slug, item.tags && item.tags.join(' '), item.authors && item.authors.join(' ')].filter(Boolean).join(' ').toLowerCase()
        });
      }
    }
    pushMany(data && data.posts, 'post');
    pushMany(data && data.pages, 'page');
    pushMany(data && data.tags, 'tag');
    pushMany(data && data.authors, 'author');
    return entries;
  }

  function ensureJsonUi() {
    var mount = document.getElementById(MODAL_ID + '-mount');
    if (!mount) return null;
    if (mount.getAttribute('data-json-initialized') === 'true') {
      return {
        input: document.getElementById(MODAL_ID + '-input'),
        status: document.getElementById(MODAL_ID + '-status'),
        list: document.getElementById(MODAL_ID + '-results')
      };
    }
    mount.setAttribute('data-json-initialized', 'true');
    var input = document.createElement('input');
    input.id = MODAL_ID + '-input';
    input.className = 'laurel-search-modal__input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = 'Search posts, pages, tags, authors';
    input.setAttribute('aria-label', 'Search');
    var status = document.createElement('p');
    status.id = MODAL_ID + '-status';
    status.className = 'laurel-search-modal__status';
    status.textContent = 'Type at least 2 characters.';
    var list = document.createElement('ol');
    list.id = MODAL_ID + '-results';
    list.className = 'laurel-search-modal__results';
    mount.appendChild(input);
    mount.appendChild(status);
    mount.appendChild(list);
    input.addEventListener('input', function () {
      if (SEARCH_MODE === 'lunr') {
        runLunrSearch(input, status, list);
      } else {
        runJsonSearch(input, status, list);
      }
    });
    return { input: input, status: status, list: list };
  }

  function openJsonModal() {
    var ui = ensureJsonUi();
    if (!ui || !ui.input) return;
    ui.input.focus();
    if (ui.input.value.trim().length >= 2) {
      runJsonSearch(ui.input, ui.status, ui.list);
    }
  }

  function openLunrModal() {
    var ui = ensureJsonUi();
    if (!ui || !ui.input) return;
    ui.input.focus();
    if (ui.input.value.trim().length >= 2) {
      runLunrSearch(ui.input, ui.status, ui.list);
    }
  }

  function clearList(list) {
    while (list && list.firstChild) list.removeChild(list.firstChild);
  }

  function runJsonSearch(input, status, list) {
    var query = input.value.trim().toLowerCase();
    clearList(list);
    if (query.length < 2) {
      status.textContent = 'Type at least 2 characters.';
      return;
    }
    status.textContent = 'Searching...';
    loadSearchJson().then(function (entries) {
      var hits = scoreEntries(entries, query).slice(0, 10);
      clearList(list);
      if (hits.length === 0) {
        status.textContent = 'No results found.';
        return;
      }
      status.textContent = '';
      renderJsonResults(hits, list);
    }).catch(function () {
      status.textContent = 'Search index unavailable.';
    });
  }

  function runLunrSearch(input, status, list) {
    var query = input.value.trim();
    clearList(list);
    if (query.length < 2) {
      status.textContent = 'Type at least 2 characters.';
      return;
    }
    status.textContent = 'Searching...';
    loadLunrIndex().then(function (bundle) {
      var byId = {};
      for (var i = 0; i < bundle.docs.length; i++) {
        byId[bundle.docs[i].id] = bundle.docs[i];
      }
      var hits = [];
      try {
        hits = bundle.index.search(query).map(function (hit) {
          return byId[hit.ref];
        }).filter(Boolean).slice(0, 10);
      } catch (_) {
        hits = [];
      }
      clearList(list);
      if (hits.length === 0) {
        status.textContent = 'No results found.';
        return;
      }
      status.textContent = '';
      renderJsonResults(hits, list);
    }).catch(function () {
      status.textContent = 'Search index unavailable.';
    });
  }

  function scoreEntries(entries, query) {
    var terms = query.split(/\\s+/).filter(Boolean);
    var scored = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var haystack = entry.terms || '';
      var matched = true;
      for (var t = 0; t < terms.length; t++) {
        if (haystack.indexOf(terms[t]) === -1) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      var title = entry.title.toLowerCase();
      var score = 0;
      for (var j = 0; j < terms.length; j++) {
        if (title.indexOf(terms[j]) !== -1) score += 5;
        if ((entry.excerpt || '').toLowerCase().indexOf(terms[j]) !== -1) score += 2;
      }
      scored.push({ entry: entry, score: score });
    }
    scored.sort(function (a, b) {
      return b.score - a.score || a.entry.title.localeCompare(b.entry.title);
    });
    return scored.map(function (hit) {
      return hit.entry;
    });
  }

  function renderJsonResults(results, list) {
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var li = document.createElement('li');
      li.className = 'laurel-search-modal__result';
      var a = document.createElement('a');
      a.href = result.url;
      a.textContent = result.title;
      li.appendChild(a);
      var kind = document.createElement('small');
      kind.textContent = result.kind;
      li.appendChild(kind);
      if (result.excerpt) {
        var p = document.createElement('p');
        p.textContent = result.excerpt;
        li.appendChild(p);
      }
      list.appendChild(li);
    }
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
      if (el.getAttribute('data-laurel-search-wired') === 'true') continue;
      el.setAttribute('data-laurel-search-wired', 'true');
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
