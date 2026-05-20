import slugify from 'slugify';

export function slugifyCliValue(value: string): string {
  const asciiSlug = slugify(value, { lower: true, strict: true });
  if (!hasNonAscii(value)) return asciiSlug;

  const normalized = value.normalize('NFKC').toLowerCase();
  let slug = '';
  let pendingDash = false;

  for (const char of normalized) {
    const asciiPiece = slugify(char, { lower: true, strict: true });
    const piece = asciiPiece || (isUnicodeSlugChar(char) ? char : '');

    if (piece) {
      if (pendingDash && slug.length > 0 && !slug.endsWith('-')) slug += '-';
      slug += piece;
      pendingDash = false;
    } else if (isSlugSeparator(char)) {
      pendingDash = slug.length > 0;
    }
  }

  return slug.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function hasNonAscii(value: string): boolean {
  return [...value].some((char) => (char.codePointAt(0) ?? 0) > 0x7f);
}

function isUnicodeSlugChar(char: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(char);
}

function isSlugSeparator(char: string): boolean {
  return /[\s\-_‐‑‒–—―・･]/u.test(char);
}
