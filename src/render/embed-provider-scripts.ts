export const EMBED_PROVIDER_SCRIPT_DATA_KEY = '__embedProviderScripts';

export const EMBED_PROVIDER_SCRIPT_TYPES = ['instagram', 'tiktok', 'twitter'] as const;

export type EmbedProviderScriptType = (typeof EMBED_PROVIDER_SCRIPT_TYPES)[number];

const PROVIDER_CLASS_BY_TYPE: Record<EmbedProviderScriptType, string> = {
  instagram: 'instagram-media',
  tiktok: 'tiktok-embed',
  twitter: 'twitter-tweet',
};

export function collectEmbedProviderScripts(html: string): Set<EmbedProviderScriptType> {
  const out = new Set<EmbedProviderScriptType>();
  if (!hasEmbedProviderScriptMarker(html)) return out;

  for (const provider of EMBED_PROVIDER_SCRIPT_TYPES) {
    if (
      hasDataProvider(html, provider) ||
      hasClassToken(html, PROVIDER_CLASS_BY_TYPE[provider]) ||
      hasProviderSpecificMarker(html, provider)
    ) {
      out.add(provider);
    }
  }
  return out;
}

export function recordEmbedProviderScripts(data: Record<string, unknown>, html: string): void {
  const found = collectEmbedProviderScripts(html);
  if (found.size === 0) return;
  const existing = getEmbedProviderScripts(data);
  const next = new Set<EmbedProviderScriptType>(existing);
  for (const provider of found) next.add(provider);
  data[EMBED_PROVIDER_SCRIPT_DATA_KEY] = next;
}

export function getEmbedProviderScripts(
  data: Record<string, unknown> | undefined,
): Set<EmbedProviderScriptType> {
  const raw = data?.[EMBED_PROVIDER_SCRIPT_DATA_KEY];
  if (raw instanceof Set) {
    return new Set(
      [...raw].filter((value): value is EmbedProviderScriptType =>
        isEmbedProviderScriptType(value),
      ),
    );
  }
  if (Array.isArray(raw)) {
    return new Set(
      raw.filter((value): value is EmbedProviderScriptType => isEmbedProviderScriptType(value)),
    );
  }
  return new Set();
}

function isEmbedProviderScriptType(value: unknown): value is EmbedProviderScriptType {
  return (
    typeof value === 'string' && (EMBED_PROVIDER_SCRIPT_TYPES as readonly string[]).includes(value)
  );
}

function hasEmbedProviderScriptMarker(html: string): boolean {
  return (
    html.includes('data-laurel-embed-provider') ||
    html.includes('twitter-tweet') ||
    html.includes('instagram-media') ||
    html.includes('tiktok-embed') ||
    html.includes('data-instgrm-permalink') ||
    html.includes('cite="https://www.tiktok.com/')
  );
}

function hasDataProvider(html: string, provider: EmbedProviderScriptType): boolean {
  const dataProvider = /\bdata-laurel-embed-provider\s*=\s*(["'])([\s\S]*?)\1/gi;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = dataProvider.exec(html)) !== null) {
    const value = (match[2] ?? '').trim().toLowerCase();
    if (value === provider) return true;
  }
  return false;
}

function hasClassToken(html: string, className: string): boolean {
  const classAttr = /\bclass\s*=\s*(["'])([\s\S]*?)\1/gi;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = classAttr.exec(html)) !== null) {
    const tokens = (match[2] ?? '').split(/\s+/);
    if (tokens.includes(className)) return true;
  }
  return false;
}

function hasProviderSpecificMarker(html: string, provider: EmbedProviderScriptType): boolean {
  switch (provider) {
    case 'instagram':
      return html.includes('data-instgrm-permalink');
    case 'tiktok':
      return html.includes('cite="https://www.tiktok.com/');
    case 'twitter':
      return false;
  }
}
