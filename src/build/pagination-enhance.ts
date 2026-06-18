import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import { renderPaginationEnhanceShim } from '~/pagination/runtime.ts';
import { ensureDir } from '~/util/fs.ts';

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
  await writeFile(dest, js, 'utf8');
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
): string {
  if (enhancementMode(config) === null) return html;
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
