import type Handlebars from 'handlebars';

type HandlebarsRuntime = typeof Handlebars;

interface FeatureImageCaptionCarrier {
  feature_image_caption?: unknown;
}

// Loader-side sanitization is the trust boundary for Ghost-shaped caption HTML.
// Keep model/API values as strings, but hand templates a SafeString so Ghost
// themes that use {{feature_image_caption}} inside <figcaption> do not
// double-escape the already-sanitized inline markup.
export function withTrustedCaptionHtml<T>(hb: HandlebarsRuntime, value: T): T {
  if (!isRecord(value)) return value;
  const caption = (value as FeatureImageCaptionCarrier).feature_image_caption;
  if (typeof caption !== 'string' || caption.length === 0) return value;
  return {
    ...(value as Record<string, unknown>),
    feature_image_caption: new hb.SafeString(caption),
  } as T;
}

export function withTrustedCaptionHtmlArray<T>(hb: HandlebarsRuntime, values: readonly T[]): T[] {
  return values.map((value) => withTrustedCaptionHtml(hb, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
