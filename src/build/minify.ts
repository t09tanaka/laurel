import type { Options as MinifierOptions } from 'html-minifier-terser';
import { pLimit } from '~/util/concurrency.ts';
import { logger } from '~/util/logger.ts';
import type { HtmlOutput } from './emit.ts';

// Conservative defaults: collapse insignificant whitespace and drop comments,
// but leave inline CSS/JS untouched. We intentionally skip `minifyCSS` /
// `minifyJS` to avoid pulling in clean-css / terser at build time and to keep
// theme-injected snippets byte-identical so cache headers stay predictable.
const DEFAULT_OPTIONS: MinifierOptions = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  collapseBooleanAttributes: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  decodeEntities: false,
  keepClosingSlash: true,
  preserveLineBreaks: false,
};

// Bounded fan-out for minifier calls. The minifier is CPU-bound and Bun's
// event loop is single-threaded, so a high cap mostly hurts cache locality
// without adding throughput. 8 matches the typical "small core count" assumed
// by node-side build tools and keeps memory pressure tame on large sites.
const MINIFY_CONCURRENCY = 8;

type MinifierFn = (html: string, options?: MinifierOptions) => Promise<string>;

let cachedMinifier: MinifierFn | null | undefined;
let warnedMissing = false;

async function loadMinifier(): Promise<MinifierFn | null> {
  if (cachedMinifier !== undefined) return cachedMinifier;
  try {
    const mod = (await import('html-minifier-terser')) as { minify: MinifierFn };
    cachedMinifier = mod.minify;
  } catch (err) {
    if (!warnedMissing) {
      logger.warn(
        `HTML minification skipped: html-minifier-terser is not installed (${err instanceof Error ? err.message : String(err)}). Install it (e.g. \`bun add html-minifier-terser\`) to enable build.minify_html.`,
      );
      warnedMissing = true;
    }
    cachedMinifier = null;
  }
  return cachedMinifier;
}

interface MinifyHtmlOutputsResult {
  inputBytes: number;
  outputBytes: number;
  minified: boolean;
}

export async function minifyHtmlOutputs(outputs: HtmlOutput[]): Promise<MinifyHtmlOutputsResult> {
  let inputBytes = 0;
  for (const out of outputs) inputBytes += Buffer.byteLength(out.html, 'utf8');

  if (outputs.length === 0) {
    return { inputBytes, outputBytes: inputBytes, minified: false };
  }

  const minify = await loadMinifier();
  if (!minify) {
    return { inputBytes, outputBytes: inputBytes, minified: false };
  }

  const limit = pLimit(MINIFY_CONCURRENCY);
  await Promise.all(
    outputs.map((out) =>
      limit(async () => {
        try {
          out.html = (await minify(out.html, DEFAULT_OPTIONS)).trimEnd();
        } catch (err) {
          // Keep the original HTML so the build still ships a valid page.
          // A theme-injected fragment of broken markup is not worth failing
          // the whole build over; surface a warning so the author can fix it.
          logger.warn(
            `HTML minification failed for ${out.outputPath}; emitting unminified (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }),
    ),
  );

  let outputBytes = 0;
  for (const out of outputs) outputBytes += Buffer.byteLength(out.html, 'utf8');
  return { inputBytes, outputBytes, minified: true };
}

// Exposed for tests to verify the soft-import contract without monkey-patching
// the module cache.
export function __resetMinifierCacheForTests(): void {
  cachedMinifier = undefined;
  warnedMissing = false;
}
