import { logger } from '~/util/logger.ts';

/**
 * Normalise a user-supplied base path so the rest of the build pipeline can
 * assume the canonical `"/segment/.../"` shape (or `"/"`). Used for both
 * `build.base_path` from laurel.toml and the `--base-path` CLI override so
 * the two stay byte-identical downstream.
 *
 * Warns (rather than errors) when the input is missing the leading `/`,
 * because forgetting it is a common slip and we can recover unambiguously.
 */
export function normalizeBasePath(basePath: string): string {
  if (typeof basePath !== 'string') {
    throw new Error('base_path must be a string');
  }
  const trimmed = basePath.trim();
  if (trimmed === '') {
    throw new Error('base_path must not be empty');
  }
  if (trimmed === '/') return '/';

  let value = trimmed;
  if (!value.startsWith('/')) {
    logger.warn(
      `base_path ${JSON.stringify(basePath)} does not start with "/"; normalising to "/${value.replace(/^\/+/, '')}/"`,
    );
    value = `/${value}`;
  }
  if (!value.endsWith('/')) value = `${value}/`;
  return value.replace(/\/{2,}/g, '/');
}
