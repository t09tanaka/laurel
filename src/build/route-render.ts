import { resolve } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { BuildContext, Plugin } from '~/plugin/types.ts';
import type { LaurelEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { LaurelError, isLaurelError } from '~/util/errors.ts';
import { injectSkipLink } from './a11y.ts';
import { rewriteBasePathUrls } from './base-path-urls.ts';
import { rewriteContentImageUrls } from './content-image-urls.ts';
import type { ContentImageAssetPlan } from './emit.ts';
import { htmlBuildId, injectHtmlBuildAttribute } from './html-metadata.ts';
import { rewriteImageCdnUrls } from './image-cdn.ts';
import type { ImageFormat } from './images.ts';
import {
  collapseDegenerateSrcset,
  injectImageDimensions,
  injectImageLqip,
  injectThemeImagePictureSources,
} from './images.ts';
import { stripUnusedLightbox } from './lightbox.ts';
import { injectPaginationEnhanceScript } from './pagination-enhance.ts';
import {
  injectPriorityImagePreload,
  injectStylesheetPreload,
  injectSubresourceIntegrity,
  normalizeResourceTagAttributes,
  removeRedundantScriptPreload,
  syncPriorityImagePreload,
} from './perf-hints.ts';
import { rewritePortalLinks, rewriteRecommendationsButton } from './portal-shim.ts';
import {
  injectPagefindSkipMeta,
  injectSearchShimScript,
  searchEngineUsesLaurelGhostSearchShim,
} from './search.ts';
import { transformSubscribeForms } from './subscribe-forms.ts';

interface RouteRenderOptions {
  cwd: string;
  config: LaurelConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  engine: LaurelEngine;
  route: RouteContext;
  plugins: readonly Plugin[];
  pluginCtx: BuildContext;
  contentImagePlan: ContentImageAssetPlan;
  // Modern image formats whose variants are actually materialised on disk
  // (`[components.images].enabled` + a configured format + sharp present). Used
  // to wrap theme `feature_image` <img> tags in a <picture> with per-format
  // <source> fallbacks. Empty when no format variants will be emitted.
  formatVariants: readonly ImageFormat[];
  portalUrls: Record<string, string>;
  recommendationsEnabled: boolean;
  // When the theme provides its own infinite-scroll script, suppress Laurel's
  // pagination enhancement shim so the two don't double-fetch the next page.
  themeOwnsInfiniteScroll?: boolean;
  warnSubscribeNoop?: (html: string) => void;
  imageDimensionCache?: Map<string, unknown>;
  imageLqipCache?: Map<string, string | null>;
}

export function isHtmlRoute(route: RouteContext): boolean {
  return route.outputContentType === undefined || route.outputContentType === 'text/html';
}

export async function renderRouteHtml(opts: RouteRenderOptions): Promise<string> {
  const { config, content, theme, engine, route, plugins, pluginCtx } = opts;
  try {
    for (const plugin of plugins) {
      if (plugin.beforeRender) await plugin.beforeRender(pluginCtx, route);
    }

    let html = engine.render(route);
    if (isHtmlRoute(route)) {
      const renderedHtml = injectSkipLink(html, config.build.csp_nonce);
      opts.warnSubscribeNoop?.(renderedHtml);
      html = collapseDegenerateSrcset(
        rewritePortalLinks({
          html: rewriteRecommendationsButton({
            html: stripUnusedLightbox(
              transformSubscribeForms(renderedHtml, config.components.subscribe),
            ),
            basePath: config.build.base_path,
            enabled: opts.recommendationsEnabled,
          }),
          urls: opts.portalUrls,
          inviteOnly: content.site.members_invite_only,
        }),
      );
      html = injectImageDimensions(html, {
        assetsRoot: resolve(opts.cwd, config.content.assets_dir),
        cache: opts.imageDimensionCache ?? new Map(),
      });
      if (config.components.images.lqip) {
        html = await injectImageLqip(html, {
          assetsRoot: resolve(opts.cwd, config.content.assets_dir),
          cache: opts.imageLqipCache ?? new Map(),
          width: config.components.images.lqip_width,
          quality: config.components.images.lqip_quality,
        });
      }
      // Wrap theme `feature_image` <img> tags (same-format size variants) in a
      // <picture> with per-format <source> fallbacks. Gated on `resize` because
      // the referenced format variants are only materialised on disk when the
      // sharp-backed resize pipeline runs. Must run before syncPriorityImagePreload
      // so the LCP preload can align with the emitted WebP <source>.
      if (config.components.images.resize && opts.formatVariants.length > 0) {
        html = injectThemeImagePictureSources(html, { formats: opts.formatVariants });
      }
      if (
        config.components.search.enabled &&
        searchEngineUsesLaurelGhostSearchShim(config.components.search.engine)
      ) {
        html = injectSearchShimScript(html, config.build.base_path, config.build.csp_nonce);
        if (
          config.components.search.engine === 'pagefind' ||
          config.components.search.engine === 'json+pagefind'
        ) {
          const post = route.kind === 'post' ? route.data.post : undefined;
          if (post && post.visibility !== 'public') {
            html = injectPagefindSkipMeta(html);
          }
        }
      }
      html = injectPaginationEnhanceScript(
        html,
        config,
        config.build.csp_nonce,
        opts.themeOwnsInfiniteScroll ?? false,
      );
      if (config.performance.dedupe_script_preload) {
        html = removeRedundantScriptPreload(html);
      }
      if (config.performance.preload_stylesheet) {
        html = injectStylesheetPreload(html);
      }
      html = normalizeResourceTagAttributes(html);
      html = injectSubresourceIntegrity(html, theme.assets.values(), config.build.base_path);
      if (config.performance.preload_lcp_image !== false) {
        // Inject an LCP preload for routes ghost_head skips (list / archive
        // feeds, posts whose LCP is a promoted content image) before aligning
        // any existing preload; the injected link already carries imagesrcset
        // so syncPriorityImagePreload leaves it untouched.
        html = injectPriorityImagePreload(html);
        html = syncPriorityImagePreload(html);
      }
      html = rewriteBasePathUrls(html, config.build.base_path);
      html = rewriteImageCdnUrls(html, { config });
      html = rewriteContentImageUrls(html, { config, plan: opts.contentImagePlan });
    }

    for (const plugin of plugins) {
      if (!plugin.afterRender) continue;
      const next = await plugin.afterRender(pluginCtx, route, html);
      if (typeof next === 'string') html = next;
    }

    if (isHtmlRoute(route)) {
      html = rewriteBasePathUrls(html, config.build.base_path);
      html = injectHtmlBuildAttribute(html, htmlBuildId(html));
    }
    return html;
  } catch (err) {
    throw wrapRenderError(err, route.url, route.template);
  }
}

function wrapRenderError(err: unknown, url: string, template: string): LaurelError {
  const prefix = `failed to render ${url} (${template})`;
  if (isLaurelError(err)) {
    return new LaurelError({
      message: `${prefix}: ${err.message}`,
      file: err.file,
      line: err.line,
      col: err.col,
      hint: err.hint,
      cause: err.cause ?? err,
      code: err.code ?? 'render',
    });
  }
  return new LaurelError({
    message: err instanceof Error ? `${prefix}: ${err.message}` : `${prefix}: ${String(err)}`,
    cause: err,
    code: 'render',
  });
}
