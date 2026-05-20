import type { NectarConfig } from './schema.ts';

export const X_ROBOTS_TAG_HEADER = 'X-Robots-Tag';
export const NOINDEX_DIRECTIVE = 'noindex';

export function isNonProductionBuild(config: NectarConfig): boolean {
  const environment = config.build?.metadata?.environment;
  return environment !== undefined && environment !== 'production';
}

export function applyNoindexHeaderForNonProduction(config: NectarConfig): NectarConfig {
  if (!isNonProductionBuild(config)) return config;

  const custom = config.deploy.headers.security.custom;
  const existingKey =
    Object.keys(custom).find((key) => key.toLowerCase() === X_ROBOTS_TAG_HEADER.toLowerCase()) ??
    X_ROBOTS_TAG_HEADER;
  const existingValue = custom[existingKey];
  if (existingValue === undefined || existingValue.trim() === '') {
    custom[existingKey] = NOINDEX_DIRECTIVE;
    return config;
  }
  if (/\bnoindex\b/i.test(existingValue)) return config;

  custom[existingKey] = `${NOINDEX_DIRECTIVE}, ${existingValue}`;
  return config;
}
