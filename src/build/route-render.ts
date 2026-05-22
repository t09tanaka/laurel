import { resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { SUBSCRIBE_NOOP_BUILD_WARNING } from '~/members/noop.ts';
import type { BuildContext, Plugin } from '~/plugin/types.ts';
import type { NectarEngine } from '~/render/engine.ts';
import type { RouteContext } from '~/render/types.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { NectarError, isNectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { injectSkipLink } from './a11y.ts';
import { rewriteBasePathUrls } from './base-path-urls.ts';
import { rewriteContentImageUrls } from './content-image-urls.ts';
import type { ContentImageAssetPlan } from './emit.ts';
import { htmlBuildId, injectHtmlBuildAttribute } from './html-metadata.ts';
import { rewriteImageCdnUrls } from './image-cdn.ts';
import { collapseDegenerateSrcset, injectImageDimensions, injectImageLqip } from './images.ts';
import { stripUnusedLightbox } from './lightbox.ts';
import {
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
  searchEngineUsesNectarGhostSearchShim,
} from './search.ts';
import { containsSubscribeFormMarkup, transformSubscribeForms } from './subscribe-forms.ts';

export interface RouteRenderOptions {
  cwd: string;
  config: NectarConfig;
  content: ContentGraph;
  theme: ThemeBundle;
  engine: NectarEngine;
  route: RouteContext;
  plugins: readonly Plugin[];
  pluginCtx: BuildContext;
  contentImagePlan: ContentImageAssetPlan;
  portalUrls: Record<string, string>;
  recommendationsEnabled: boolean;
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
      if (
        config.components.search.enabled &&
        searchEngineUsesNectarGhostSearchShim(config.components.search.engine)
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
      if (config.performance.dedupe_script_preload) {
        html = removeRedundantScriptPreload(html);
      }
      if (config.performance.preload_stylesheet) {
        html = injectStylesheetPreload(html);
      }
      html = normalizeResourceTagAttributes(html);
      html = injectSubresourceIntegrity(html, theme.assets.values(), config.build.base_path);
      if (config.performance.preload_lcp_image !== false) {
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

export function createSubscribeNoopWarner(
  config: NectarConfig,
  content: ContentGraph,
): (html: string) => void {
  let warned = false;
  return (html: string): void => {
    if (
      !warned &&
      !content.site.members_invite_only &&
      config.components.subscribe.provider === 'none' &&
      containsSubscribeFormMarkup(html)
    ) {
      warned = true;
      logger.warn(SUBSCRIBE_NOOP_BUILD_WARNING);
    }
  };
}

function wrapRenderError(err: unknown, url: string, template: string): NectarError {
  const prefix = `failed to render ${url} (${template})`;
  if (isNectarError(err)) {
    return new NectarError({
      message: `${prefix}: ${err.message}`,
      file: err.file,
      line: err.line,
      col: err.col,
      hint: err.hint,
      cause: err.cause ?? err,
      code: err.code ?? 'render',
    });
  }
  return new NectarError({
    message: err instanceof Error ? `${prefix}: ${err.message}` : `${prefix}: ${String(err)}`,
    cause: err,
    code: 'render',
  });
}
