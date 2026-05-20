import enMessages from './en.json';

const messages = {
  en: enMessages,
} as const;

export type CliLocale = keyof typeof messages;
export type MessageId = keyof typeof enMessages;
export type MessageParams = Record<string, boolean | number | string | null | undefined>;
export type LocaleEnv = Record<string, string | undefined>;

const DEFAULT_LOCALE: CliLocale = 'en';

export function detectCliLocale(env: LocaleEnv): CliLocale {
  return normalizeLocale(env.LC_MESSAGES) ?? normalizeLocale(env.LANG) ?? DEFAULT_LOCALE;
}

export function t(
  id: MessageId,
  params: MessageParams = {},
  locale: CliLocale = detectCliLocale(process.env),
): string {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE];
  const template = table[id] ?? messages[DEFAULT_LOCALE][id];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function normalizeLocale(raw: string | undefined): CliLocale | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const normalized = raw.trim().split('.')[0]?.split('@')[0]?.replace(/_/g, '-').toLowerCase();
  if (normalized === undefined) return undefined;
  if (normalized in messages) return normalized as CliLocale;
  const base = normalized.split('-')[0];
  return base !== undefined && base in messages ? (base as CliLocale) : undefined;
}
