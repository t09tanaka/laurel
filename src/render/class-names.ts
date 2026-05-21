import slugify from 'slugify';

// Ghost's `post_class` emits more than just tag/featured tokens - themes
// (Source included) hook layout into `no-image`/`image` and `page`, so a
// minimal "post tag-x" output drops styles that depend on these tokens.
export function computePostClass(post: {
  tags?: { slug: string }[];
  featured?: boolean;
  feature_image?: string | undefined;
  html?: string;
  page?: boolean;
  visibility?: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
}): string {
  const tokens = ['post'];
  for (const t of post.tags ?? []) tokens.push(`tag-${t.slug}`);
  if (post.featured) tokens.push('featured');
  switch (post.visibility) {
    case 'members':
      tokens.push('members-only');
      break;
    case 'paid':
    case 'tiers':
    case 'filter':
      tokens.push('paid-only');
      break;
    default:
      tokens.push('access');
      break;
  }
  // Both `image` (Ghost legacy) and `feature-image` (Casper / Source variant)
  // markers are emitted together so theme CSS that hooks either selector
  // keeps working. `image-cover` is the Source-specific layout hook for
  // posts that should fill the hero band. Posts without a feature image
  // fall back to `no-image` so themes can collapse the cover slot.
  if (post.feature_image) {
    tokens.push('image', 'feature-image', 'image-cover');
  } else {
    tokens.push('no-image');
  }
  if (!post.html || post.html.trim() === '') tokens.push('no-content');
  if (post.page) tokens.push('page');
  return tokens.join(' ');
}

export function bodyClassToken(prefix: string, slug: unknown): string | undefined {
  if (typeof slug !== 'string') return undefined;
  const sanitized = slugify(slug, { lower: true, strict: true });
  if (!sanitized) return undefined;
  return `${prefix}-${sanitized}`;
}
