// Live-reload pieces shared by `laurel serve` and `laurel dev`. The two commands
// both serve a built site and need to (a) inject a tiny WebSocket client into
// every HTML response and (b) push a "reload" message when the build finishes.
// Keeping this module dependency-free (no Bun.serve / no fs.watch) lets the
// emit step and the watch loop pick exactly the bits they need without dragging
// in the server lifecycle.

export const LIVERELOAD_PATH = '/__laurel_livereload';

// The path requested by `laurel dev` for the standalone client script. The
// task spec lists `/__laurel/livereload.js` as the canonical URL; both that
// path and the inline-served LIVERELOAD_PATH WebSocket endpoint live under
// the `/__laurel` prefix so the surface is grep-able and easy to firewall.
export const LIVERELOAD_SCRIPT_PATH = '/__laurel/livereload.js';

// Standalone client served at LIVERELOAD_SCRIPT_PATH. Browsers fetch this when
// they see `<script src="/__laurel/livereload.js" defer></script>` injected by
// the emit step. Self-guards via window.__laurelLiveReload so repeated injects
// (e.g. after a redirect or back/forward navigation) don't open duplicate
// sockets. CSS-only changes are hot-swapped by replacing the `<link>` href
// instead of reloading the whole page; everything else falls back to
// `location.reload()`.
export const LIVERELOAD_CLIENT_JS = `(function(){
  if (window.__laurelLiveReload) return;
  window.__laurelLiveReload = true;
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '${LIVERELOAD_PATH}';
  function connect() {
    var ws;
    try { ws = new WebSocket(url); } catch (e) { setTimeout(connect, 1000); return; }
    ws.onmessage = function(e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { msg = { type: e.data }; }
      if (msg.type === 'css') {
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
          var link = links[i];
          var href = link.getAttribute('href');
          if (!href) continue;
          var bust = (href.indexOf('?') === -1 ? '?' : '&') + '__laurel=' + Date.now();
          link.setAttribute('href', href.split('?')[0] + bust);
        }
        return;
      }
      location.reload();
    };
    ws.onclose = function() { setTimeout(connect, 1000); };
    ws.onerror = function() { try { ws.close(); } catch (_) {} };
  }
  connect();
})();
`;

// Inline (no extra HTTP round-trip) variant used by `laurel serve`'s legacy
// inject path. Same protocol as the external script but compiled to a single
// line so it doesn't add visible whitespace to the served HTML.
export const LIVERELOAD_INLINE_SCRIPT = `<script>(function(){if(window.__laurelLiveReload)return;window.__laurelLiveReload=true;var p=location.protocol==='https:'?'wss:':'ws:';function c(){var w;try{w=new WebSocket(p+'//'+location.host+'${LIVERELOAD_PATH}');}catch(e){setTimeout(c,1000);return;}w.onmessage=function(e){var m;try{m=JSON.parse(e.data);}catch(_){m={type:e.data};}if(m.type==='css'){var l=document.querySelectorAll('link[rel=\"stylesheet\"]');for(var i=0;i<l.length;i++){var h=l[i].getAttribute('href');if(!h)continue;l[i].setAttribute('href',h.split('?')[0]+(h.indexOf('?')===-1?'?':'&')+'__laurel='+Date.now());}return;}location.reload();};w.onclose=function(){setTimeout(c,1000);};w.onerror=function(){try{w.close();}catch(_){}};}c();})();</script>`;

// External-script variant used by `laurel dev`. Emitted with `defer` so it
// never blocks first paint; the WebSocket only opens after the document is
// parsed, which is fine because the reload signal is irrelevant before the
// page is interactive anyway.
export const LIVERELOAD_EXTERNAL_TAG = `<script src="${LIVERELOAD_SCRIPT_PATH}" defer></script>`;

type LiveReloadMode = 'inline' | 'external';

// Inject the WebSocket client into an HTML document. Choice of variant:
//   - 'inline'   → `laurel serve` legacy: keeps the client one-shot with no
//                  extra HTTP round-trip, useful when the serve loop streams
//                  the response immediately.
//   - 'external' → `laurel dev`: references the script served at
//                  LIVERELOAD_SCRIPT_PATH so the HTML stays cacheable and
//                  the client logic lives in exactly one place.
// In both cases the script lands just before `</body>` so it never blocks
// first paint; when </body> is missing (fragment / 404 page / hand-written
// snippet) we append at the end so the client still loads.
export function injectLiveReload(html: string, mode: LiveReloadMode = 'inline'): string {
  const snippet = mode === 'external' ? LIVERELOAD_EXTERNAL_TAG : LIVERELOAD_INLINE_SCRIPT;
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + snippet;
  return html.slice(0, idx) + snippet + html.slice(idx);
}

// Message shape pushed over the WebSocket. JSON makes future expansion (e.g.
// per-file invalidation, error overlays) additive — the client falls back to
// `location.reload()` for any message type it doesn't recognize, so old tabs
// don't break when the server learns new tricks.
interface ReloadMessage {
  type: 'reload' | 'css';
}

export function encodeReloadMessage(msg: ReloadMessage): string {
  return JSON.stringify(msg);
}
