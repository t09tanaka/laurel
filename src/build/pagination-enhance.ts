import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import { renderPaginationEnhanceShim } from '~/pagination/runtime.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir } from '~/util/fs.ts';

// Themes like Ghost's Casper (`infinite-scroll.js`) and Source (`pagination.js`)
// ship a self-contained infinite-scroll script that follows the `rel="next"`
// link Laurel already emits and appends the fetched cards to the feed — it works
// unchanged on Laurel's static output. When such a script is present, Laurel's
// own enhancement shim must stand down: running both makes each next page get
// fetched twice (double network request) and its cards appended twice
// (duplicated posts that break the feed grid). Yielding to the theme mirrors
// Ghost, where the theme's own script is the sole infinite-scroll mechanism.
//
// Detection is a content signature on the theme's JS assets: a JS file that
// queries the `rel="next"` pagination link *and* appends DOM nodes. The link
// query is matched as the `link[rel=next]` attribute-selector form (what both
// Casper and Source pass to `querySelector`), not a bare `rel=next` — that keeps
// embedded HTML strings, `rel: "next"` object props, and source-map fragments
// from tripping it. Both themes match even after minification (string literals
// and DOM method names survive). The two signals need only co-occur in the file,
// not sit adjacent; pairing them is a guard against a vendor bundle that happens
// to mention one alone. A theme that does neither (or only one) keeps Laurel's
// shim; a false negative just degrades to the prior double-load behaviour, never
// worse. Known gap: themes that append via `append()` / `insertAdjacentHTML` /
// `innerHTML +=` rather than `appendChild` are not detected (none of Laurel's
// target themes do this).
const NATIVE_NEXT_LINK = /link\[\s*rel\s*=\s*\\?["']?next/i;

export async function themeHasNativeInfiniteScroll(
  theme: Pick<ThemeBundle, 'assets'>,
): Promise<boolean> {
  for (const asset of theme.assets.values()) {
    if (!asset.logicalPath.toLowerCase().endsWith('.js')) continue;
    const text = await Bun.file(asset.sourcePath).text();
    if (NATIVE_NEXT_LINK.test(text) && text.includes('appendChild')) return true;
  }
  return false;
}

// The pagination enhancement only ships JS in `infinite` / `load-more` modes;
// `links` (the default) stays a no-op so the static build is byte-identical.
function enhancementMode(config: LaurelConfig): 'infinite' | 'load-more' | null {
  const mode = config.components.pagination.mode;
  return mode === 'links' ? null : mode;
}

// Write the progressive-enhancement runtime to `dist/pagination/enhance.js`.
// Returns the destination path, or null when the feature is disabled.
export async function emitPaginationEnhanceShim(opts: {
  config: LaurelConfig;
  outputDir: string;
}): Promise<string | null> {
  const { config, outputDir } = opts;
  const mode = enhancementMode(config);
  if (!mode) return null;
  const dir = join(outputDir, 'pagination');
  await ensureDir(dir);
  const dest = join(dir, 'enhance.js');
  const js = renderPaginationEnhanceShim({
    mode,
    containerSelector: config.components.pagination.container_selector,
    itemSelector: config.components.pagination.item_selector,
  });
  await Bun.write(dest, js);
  return dest;
}

function basePathPrefix(basePath: string): string {
  const normalized = basePath && basePath !== '/' ? basePath : '/';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

// Inject `<script defer src="…/pagination/enhance.js">` into a feed page.
// Gated on the presence of a `rel="next"` link so the runtime only loads on
// paginated feed pages that actually have a next page — post / single pages and
// the final page of a feed (no `rel="next"`) are skipped. Idempotent via the
// `data-laurel-pagination-enhance` marker.
export function injectPaginationEnhanceScript(
  html: string,
  config: LaurelConfig,
  cspNonce?: string,
  // True when the active theme ships its own infinite-scroll script; the shim
  // yields so the two don't double-fetch and double-append. See
  // `themeHasNativeInfiniteScroll`.
  themeOwnsInfiniteScroll = false,
): string {
  if (enhancementMode(config) === null) return html;
  if (themeOwnsInfiniteScroll) return html;
  if (html.includes('data-laurel-pagination-enhance')) return html;
  if (!/<link\b[^>]*\brel=["']next["']/i.test(html)) return html;
  const headCloseMatch = /<\/head\s*>/i.exec(html);
  if (!headCloseMatch) return html;
  const src = `${basePathPrefix(config.build.base_path)}pagination/enhance.js`;
  const nonce = cspNonce ? ` nonce="${cspNonce}"` : '';
  const tag = `<script defer src="${src}" data-laurel-pagination-enhance${nonce}></script>`;
  const insertAt = headCloseMatch.index;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
}
