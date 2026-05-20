import { cardAssetsExcludeSet, isCardAssetsEnabled } from '~/build/card-assets.ts';
import type { ThemeCardAssets } from '~/theme/types.ts';

export const KOENIG_RUNTIME_DATA_KEY = '__koenigRuntimeCardTypes';

export const KOENIG_RUNTIME_CARD_TYPES = ['audio', 'embed', 'signup', 'toggle', 'video'] as const;

export type KoenigRuntimeCardType = (typeof KOENIG_RUNTIME_CARD_TYPES)[number];

const CARD_CLASS_BY_TYPE: Record<KoenigRuntimeCardType, string> = {
  audio: 'kg-audio-card',
  embed: 'kg-embed-card',
  signup: 'kg-signup-card',
  toggle: 'kg-toggle-card',
  video: 'kg-video-card',
};

export function collectKoenigRuntimeCardTypes(html: string): Set<KoenigRuntimeCardType> {
  const out = new Set<KoenigRuntimeCardType>();
  if (!html.includes('kg-')) return out;
  for (const type of KOENIG_RUNTIME_CARD_TYPES) {
    if (hasClassToken(html, CARD_CLASS_BY_TYPE[type])) out.add(type);
  }
  return out;
}

export function recordKoenigRuntimeCardTypes(data: Record<string, unknown>, html: string): void {
  const found = collectKoenigRuntimeCardTypes(html);
  if (found.size === 0) return;
  const existing = getKoenigRuntimeCardTypes(data);
  const next = new Set<KoenigRuntimeCardType>(existing);
  for (const type of found) next.add(type);
  data[KOENIG_RUNTIME_DATA_KEY] = next;
}

export function getKoenigRuntimeCardTypes(
  data: Record<string, unknown> | undefined,
): Set<KoenigRuntimeCardType> {
  const raw = data?.[KOENIG_RUNTIME_DATA_KEY];
  if (raw instanceof Set) {
    return new Set(
      [...raw].filter((value): value is KoenigRuntimeCardType => isKoenigRuntimeCardType(value)),
    );
  }
  if (Array.isArray(raw)) {
    return new Set(
      raw.filter((value): value is KoenigRuntimeCardType => isKoenigRuntimeCardType(value)),
    );
  }
  return new Set();
}

export function shouldInjectKoenigRuntime(
  cardAssets: ThemeCardAssets,
  cardTypes: Set<KoenigRuntimeCardType>,
): boolean {
  return enabledKoenigRuntimeCardTypes(cardAssets, cardTypes).length > 0;
}

export function enabledKoenigRuntimeCardTypes(
  cardAssets: ThemeCardAssets,
  cardTypes: Set<KoenigRuntimeCardType>,
): KoenigRuntimeCardType[] {
  if (!isCardAssetsEnabled(cardAssets) || cardTypes.size === 0) return [];
  const exclude = cardAssetsExcludeSet(cardAssets);
  const out: KoenigRuntimeCardType[] = [];
  for (const type of cardTypes) {
    if (!exclude.has(type)) out.push(type);
  }
  return out.sort();
}

function isKoenigRuntimeCardType(value: unknown): value is KoenigRuntimeCardType {
  return (
    typeof value === 'string' && (KOENIG_RUNTIME_CARD_TYPES as readonly string[]).includes(value)
  );
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
