const PAYWALL_MARKER = '<!-- members -->';

export function truncateMarkdownForPaywall(body: string, wordCount: number): string {
  const markerIdx = body.indexOf(PAYWALL_MARKER);
  if (markerIdx >= 0) {
    return body.slice(0, markerIdx).trimEnd();
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

export function buildPaywallStub(visibility: 'members' | 'paid'): string {
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
