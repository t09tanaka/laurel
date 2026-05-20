import slugify from 'slugify';

export const CLI_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function slugifyCliValue(value: string): string {
  return slugify(value, { lower: true, strict: true });
}

export function isValidCliSlug(value: string): boolean {
  return CLI_SLUG_PATTERN.test(value);
}
