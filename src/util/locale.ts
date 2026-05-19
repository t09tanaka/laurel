const RTL_LANGUAGE_TAGS = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'ha',
  'he',
  'khw',
  'ks',
  'ps',
  'sd',
  'ur',
  'yi',
]);

export function directionForLocale(locale: string | undefined | null): 'ltr' | 'rtl' {
  if (!locale) return 'ltr';
  const primary = locale.split(/[-_]/)[0]?.toLowerCase();
  if (!primary) return 'ltr';
  return RTL_LANGUAGE_TAGS.has(primary) ? 'rtl' : 'ltr';
}
