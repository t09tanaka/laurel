// Markdown paywall split markers. We accept three spellings:
//   - `<!-- members -->`   Laurel's own convention (the original; still works).
//   - `<!-- members-only -->`  Mirrors the documented #206 convention.
//   - `<!--kg-card-begin: paywall-->`  Matches Ghost's Koenig editor output so
//     posts pasted from a Ghost export keep their split point.
// All three are matched as a regex so optional whitespace inside the comment
// (`<!--kg-card-begin:paywall-->` with no space) is tolerated. The first
// occurrence wins so we cut at the earliest possible split, never leaking the
// rest of the body.
const PAYWALL_MARKER_RE = /<!--\s*(?:members(?:-only)?|kg-card-begin:\s*paywall)\s*-->/i;

export function findPaywallMarker(body: string): { index: number; length: number } | null {
  const match = PAYWALL_MARKER_RE.exec(body);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

export function truncateMarkdownForPaywall(body: string, wordCount: number): string {
  const marker = findPaywallMarker(body);
  if (marker) {
    return body.slice(0, marker.index).trimEnd();
  }
  if (wordCount <= 0) return '';
  const words = body.split(/(\s+)/);
  let count = 0;
  const kept: string[] = [];
  for (const piece of words) {
    if (/^\s+$/.test(piece) || piece === '') {
      kept.push(piece);
      continue;
    }
    if (count >= wordCount) break;
    kept.push(piece);
    count += 1;
  }
  return kept.join('').trimEnd();
}

// `tiers` (visibility restricted to specific tiers) and `filter` (visibility
// gated by a NQL filter expression) are both Ghost-side concepts that require a
// signed-in viewer to evaluate. Laurel's static runtime has no such viewer, so
// both are rendered as members-grade gating: the same paywall stub copy as
// `members`. The `data-paywall-visibility` attribute still carries the exact
// upstream value so theme JS or analytics can branch if they need to.
export type PaywallVisibility = 'members' | 'paid' | 'tiers' | 'filter';

export function buildPaywallStub(visibility: PaywallVisibility): string {
  const heading =
    visibility === 'paid'
      ? 'This post is for paying subscribers only'
      : 'This post is for subscribers only';
  return [
    `<div class="gh-paywall-stub" data-paywall-visibility="${visibility}">`,
    `<h2 class="gh-paywall-stub-title">${heading}</h2>`,
    '<p class="gh-paywall-stub-text">Subscribe to read more.</p>',
    '<a class="gh-paywall-stub-cta" href="#/portal/signup" data-portal="signup">Subscribe</a>',
    '</div>',
  ].join('');
}
