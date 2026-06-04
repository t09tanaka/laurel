# Bookmark Insert Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors insert Ghost-compatible bookmark cards from the `+` menu in the post/page editor, with server-side OGP metadata fetch and round-trip to the existing `{{< bookmark … />}}` shortcode.

**Architecture:** Add a ProseMirror `bookmark` block atom node + NodeView in the dashboard editor. Markdown round-trip via a new parser/serializer pair that targets the shortcode already understood by `src/content/markdown.ts`. A new `POST /api/ogp` route on the dashboard server fetches the URL behind SSRF guards and parses OGP / Twitter / `<title>` metadata.

**Tech Stack:** Bun, TypeScript (strict), ProseMirror (existing), prosemirror-markdown, markdown-it (existing), htmlparser2 (existing dependency), `bun test`, Biome.

**Spec:** `docs/superpowers/plans/../specs/2026-05-26-bookmark-insert-menu-design.md`

---

## File Structure

New files:

- `src/cli/dashboard/ogp.ts` — pure SSRF classifier + HTML metadata picker + high-level `fetchOgp` with injectable `fetch` / `lookup`
- `src/cli/dashboard/web/lib/prose-bookmark-schema.ts` — pure ProseMirror node spec + attr constants
- `src/cli/dashboard/web/lib/prose-bookmark-markdown.ts` — pure markdown-it block rule + prosemirror-markdown token + serializer for the bookmark node
- `src/cli/dashboard/web/lib/prose-bookmark-view.ts` — DOM-side NodeView (Replace / Remove / caption)
- `tests/cli/dashboard/ogp.test.ts`
- `tests/cli/dashboard/prose-bookmark-schema.test.ts`
- `tests/cli/dashboard/prose-bookmark-markdown.test.ts`

Modified files:

- `src/cli/dashboard/web/lib/prose-insert-menu-logic.ts` — add `validateBookmarkUrl`
- `src/cli/dashboard/web/lib/prose-insert-menu.ts` — add Bookmark item with new `inputView` shape, integrate replace-via-input
- `src/cli/dashboard/web/lib/api.ts` — add `fetchOgp(url)` client
- `src/cli/dashboard/web/components/ProseEditor.tsx` — extend schema with bookmark, register parser+serializer, register `nodeViews.bookmark`, wire `getOgp` upload into `insertMenuPlugin`
- `src/cli/commands/dashboard.ts` — register `POST /api/ogp` route (delegates to `ogp.ts`)
- `src/cli/dashboard/web/styles.css` — `.proseBookmarkCard*` and `.proseInsertInputView*` classes
- `tests/cli/dashboard/prose-insert-menu.test.ts` — add tests for `validateBookmarkUrl` and the new menu item enablement

---

## Conventions used in every task

- Test framework is `bun test` (alias `bun:test` in imports).
- Strict TypeScript. No `any`. Use `unknown` + narrow.
- No emojis in code/comments/filenames.
- Comment only WHY when surprising; do not narrate the code.
- Commit per task with `git commit -m "<conventional message>"` and the standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Do not use `git commit --amend`.
- Do not add port changes (docker-compose etc.) to any commit.

---

## Task 1: OGP HTML metadata picker (pure)

**Files:**
- Create: `src/cli/dashboard/ogp.ts`
- Create: `tests/cli/dashboard/ogp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/dashboard/ogp.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { pickMetadata } from '../../../src/cli/dashboard/ogp.ts';

const FULL_HTML = `
<!doctype html><html><head>
<title>Fallback Title</title>
<meta name="description" content="Plain description.">
<meta name="author" content="Jane Doe">
<meta property="og:title" content="OG Title">
<meta property="og:description" content="OG description.">
<meta property="og:site_name" content="Example Publisher">
<meta property="og:image" content="https://cdn.example.com/cover.png">
<meta property="og:image:secure_url" content="https://cdn.example.com/cover-secure.png">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="icon" href="/favicon-64.png" sizes="64x64">
</head><body></body></html>
`;

describe('pickMetadata', () => {
  test('prefers og:image:secure_url, og:title, og:description, og:site_name', () => {
    const meta = pickMetadata(FULL_HTML, new URL('https://example.com/post'));
    expect(meta.title).toBe('OG Title');
    expect(meta.description).toBe('OG description.');
    expect(meta.publisher).toBe('Example Publisher');
    expect(meta.thumbnail).toBe('https://cdn.example.com/cover-secure.png');
    expect(meta.author).toBe('Jane Doe');
  });

  test('picks the largest icon by sizes attribute', () => {
    const meta = pickMetadata(FULL_HTML, new URL('https://example.com/post'));
    expect(meta.icon).toBe('https://example.com/favicon-64.png');
  });

  test('falls back to <title> and meta description when og:* missing', () => {
    const html = `<html><head><title>Just Title</title><meta name="description" content="d"></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/x'));
    expect(meta.title).toBe('Just Title');
    expect(meta.description).toBe('d');
  });

  test('falls back to twitter:* when both og:* and bare tags missing', () => {
    const html = `<html><head><meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://cdn/x.png"></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/'));
    expect(meta.title).toBe('T');
    expect(meta.description).toBe('D');
    expect(meta.thumbnail).toBe('https://cdn/x.png');
  });

  test('falls back to URL hostname as publisher and /favicon.ico as icon', () => {
    const html = `<html><head><title>x</title></head></html>`;
    const meta = pickMetadata(html, new URL('https://news.example.org/a'));
    expect(meta.publisher).toBe('news.example.org');
    expect(meta.icon).toBe('https://news.example.org/favicon.ico');
  });

  test('truncates each text field to 300 chars and trims whitespace', () => {
    const long = 'a'.repeat(500);
    const html = `<html><head><title>  ${long}  </title></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/'));
    expect(meta.title.length).toBe(300);
    expect(meta.title.startsWith('a')).toBe(true);
  });

  test('resolves relative thumbnail URLs against the final URL', () => {
    const html = `<html><head><meta property="og:image" content="/cover.png"></head></html>`;
    const meta = pickMetadata(html, new URL('https://blog.example.com/post/'));
    expect(meta.thumbnail).toBe('https://blog.example.com/cover.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: FAIL — module `src/cli/dashboard/ogp.ts` not found.

- [ ] **Step 3: Implement `pickMetadata` and minimal scaffolding**

Create `src/cli/dashboard/ogp.ts`:

```ts
// Server-side OGP fetcher for the bookmark insert menu.
//
// Split into three concerns:
//   1. `classifyHost` / `classifyResolvedIp` — SSRF guard (pure).
//   2. `pickMetadata` — pure HTML → OgpMeta with the precedence rules
//      Ghost Koenig uses for bookmark cards.
//   3. `fetchOgp` — runtime fetch with manual redirect, body cap,
//      AbortController timeout, DNS check per hop.

import { Parser } from 'htmlparser2';

export interface OgpMeta {
  url: string;
  title: string;
  description: string;
  icon: string;
  thumbnail: string;
  author: string;
  publisher: string;
}

const TEXT_FIELD_MAX = 300;

function trimTo(value: string, max = TEXT_FIELD_MAX): string {
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function resolveUrl(value: string, base: URL): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function parseSizes(raw: string | undefined): number {
  if (!raw) return 0;
  // "32x32" or "16x16 32x32 64x64" — take the largest square axis.
  const matches = raw.match(/(\d+)x(\d+)/gi);
  if (!matches) return 0;
  let best = 0;
  for (const m of matches) {
    const [w, h] = m.split(/x/i).map((n) => Number(n));
    const size = Math.min(w ?? 0, h ?? 0);
    if (size > best) best = size;
  }
  return best;
}

export function pickMetadata(html: string, finalUrl: URL): OgpMeta {
  let ogTitle = '';
  let twTitle = '';
  let docTitle = '';
  let ogDesc = '';
  let twDesc = '';
  let metaDesc = '';
  let ogImageSecure = '';
  let ogImage = '';
  let twImage = '';
  let siteName = '';
  let author = '';
  let articleAuthor = '';
  let bestIconHref = '';
  let bestIconSize = -1;

  let inTitle = false;
  const titleBuf: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title') {
          inTitle = true;
          return;
        }
        if (name === 'meta') {
          const prop = (attrs.property ?? '').toLowerCase();
          const nameAttr = (attrs.name ?? '').toLowerCase();
          const content = attrs.content ?? '';
          if (!content) return;
          if (prop === 'og:title') ogTitle = content;
          else if (prop === 'og:description') ogDesc = content;
          else if (prop === 'og:image') ogImage = content;
          else if (prop === 'og:image:secure_url') ogImageSecure = content;
          else if (prop === 'og:site_name') siteName = content;
          else if (prop === 'article:author') articleAuthor = content;
          else if (nameAttr === 'twitter:title') twTitle = content;
          else if (nameAttr === 'twitter:description') twDesc = content;
          else if (nameAttr === 'twitter:image') twImage = content;
          else if (nameAttr === 'description') metaDesc = content;
          else if (nameAttr === 'author') author = content;
          return;
        }
        if (name === 'link') {
          const rel = (attrs.rel ?? '').toLowerCase();
          if (!rel.includes('icon')) return;
          const href = attrs.href ?? '';
          if (!href) return;
          const size = parseSizes(attrs.sizes);
          if (size > bestIconSize) {
            bestIconSize = size;
            bestIconHref = href;
          } else if (bestIconHref === '' && size === 0) {
            bestIconHref = href;
          }
        }
      },
      ontext(text) {
        if (inTitle) titleBuf.push(text);
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();
  docTitle = titleBuf.join('').trim();

  const title = ogTitle || twTitle || docTitle;
  const description = ogDesc || twDesc || metaDesc;
  const thumbnailRaw = ogImageSecure || ogImage || twImage;
  const thumbnail = thumbnailRaw ? resolveUrl(thumbnailRaw, finalUrl) : '';
  const iconRaw = bestIconHref || '/favicon.ico';
  const icon = resolveUrl(iconRaw, finalUrl);
  const publisher = siteName || finalUrl.hostname;
  const finalAuthor = author || articleAuthor;

  return {
    url: finalUrl.toString(),
    title: trimTo(title),
    description: trimTo(description),
    icon: trimTo(icon),
    thumbnail: trimTo(thumbnail),
    author: trimTo(finalAuthor),
    publisher: trimTo(publisher),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: all 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/ogp.ts tests/cli/dashboard/ogp.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add pickMetadata for OGP bookmark fetcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: SSRF host + IP classifier

**Files:**
- Modify: `src/cli/dashboard/ogp.ts`
- Modify: `tests/cli/dashboard/ogp.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/cli/dashboard/ogp.test.ts`:

```ts
import { classifyHost, classifyResolvedIp } from '../../../src/cli/dashboard/ogp.ts';

describe('classifyHost', () => {
  test('blocks localhost variants', () => {
    expect(classifyHost('localhost')).toBe('blocked');
    expect(classifyHost('foo.localhost')).toBe('blocked');
    expect(classifyHost('bar.local')).toBe('blocked');
    expect(classifyHost('svc.internal')).toBe('blocked');
  });

  test('allows ordinary public hostnames', () => {
    expect(classifyHost('example.com')).toBe('public');
    expect(classifyHost('news.example.org')).toBe('public');
  });

  test('blocks literal loopback / private / link-local / metadata IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.7.7.7',
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
    ]) {
      expect(classifyHost(ip)).toBe('blocked');
    }
  });

  test('blocks literal loopback / unique-local / link-local IPv6', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12::1', 'fe80::1', '::', '::ffff:127.0.0.1']) {
      expect(classifyHost(ip)).toBe('blocked');
    }
  });

  test('allows literal public IPv4 / IPv6', () => {
    expect(classifyHost('8.8.8.8')).toBe('public');
    expect(classifyHost('2606:4700:4700::1111')).toBe('public');
  });
});

describe('classifyResolvedIp', () => {
  test('mirrors classifyHost for literal IPs', () => {
    expect(classifyResolvedIp('127.0.0.1')).toBe('blocked');
    expect(classifyResolvedIp('192.168.0.5')).toBe('blocked');
    expect(classifyResolvedIp('169.254.169.254')).toBe('blocked');
    expect(classifyResolvedIp('fc00::1')).toBe('blocked');
    expect(classifyResolvedIp('8.8.8.8')).toBe('public');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: 3 new describe blocks fail — `classifyHost`/`classifyResolvedIp` not exported.

- [ ] **Step 3: Implement classifiers in `src/cli/dashboard/ogp.ts`**

Add the following exports to `src/cli/dashboard/ogp.ts` (above `pickMetadata`):

```ts
const BLOCKED_HOSTNAMES = new Set(['localhost']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal'];

export function classifyHost(hostname: string): 'public' | 'blocked' {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(h)) return 'blocked';
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return 'blocked';
  // If the hostname parses as a literal IP, defer to the IP classifier.
  if (isIpLiteral(h)) return classifyResolvedIp(h);
  return 'public';
}

export function classifyResolvedIp(ip: string): 'public' | 'blocked' {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower.includes(':')) return classifyIpv6(lower);
  return classifyIpv4(lower);
}

function isIpLiteral(value: string): boolean {
  if (value.includes(':')) return true;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function classifyIpv4(value: string): 'public' | 'blocked' {
  const parts = value.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'blocked';
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return 'blocked'; // 0.0.0.0/8 unspecified / "this network"
  if (a === 127) return 'blocked'; // loopback
  if (a === 10) return 'blocked'; // private
  if (a === 192 && b === 168) return 'blocked'; // private
  if (a === 172 && b >= 16 && b <= 31) return 'blocked'; // private
  if (a === 169 && b === 254) return 'blocked'; // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return 'blocked'; // CGNAT
  if (a >= 224) return 'blocked'; // multicast + reserved
  return 'public';
}

function classifyIpv6(value: string): 'public' | 'blocked' {
  // Handle the IPv4-mapped form ::ffff:1.2.3.4 by extracting the v4 tail.
  const v4Mapped = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) return classifyIpv4(v4Mapped[1] as string);
  const unspec = value === '::' || value === '0:0:0:0:0:0:0:0';
  if (unspec) return 'blocked';
  if (value === '::1' || /^0:0:0:0:0:0:0:1$/.test(value)) return 'blocked';
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return 'blocked';
  // fe80::/10 — link local
  if (/^fe[89ab][0-9a-f]:/.test(value)) return 'blocked';
  // ff00::/8 — multicast
  if (/^ff[0-9a-f]{2}:/.test(value)) return 'blocked';
  return 'public';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/ogp.ts tests/cli/dashboard/ogp.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add SSRF host/IP classifier for OGP fetcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `fetchOgp` runtime with injectable fetch + DNS

**Files:**
- Modify: `src/cli/dashboard/ogp.ts`
- Modify: `tests/cli/dashboard/ogp.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/cli/dashboard/ogp.test.ts`:

```ts
import { fetchOgp, type FetchOgpResult } from '../../../src/cli/dashboard/ogp.ts';

function htmlResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function makeOpts(overrides: Partial<Parameters<typeof fetchOgp>[1]> = {}) {
  return {
    timeoutMs: 50,
    maxBytes: 1024 * 1024,
    maxRedirects: 3,
    lookup: async () => '8.8.8.8',
    ...overrides,
  };
}

describe('fetchOgp', () => {
  test('returns ok=false with invalid_url for non-http schemes', async () => {
    const r = await fetchOgp('javascript:alert(1)', makeOpts({ fetch: async () => htmlResponse('') }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_url');
  });

  test('returns ok=false with blocked for localhost hostnames', async () => {
    const r = await fetchOgp('http://localhost/x', makeOpts({ fetch: async () => htmlResponse('') }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('returns ok=false with blocked when DNS resolves to private IP', async () => {
    const r = await fetchOgp(
      'http://example.com/',
      makeOpts({ lookup: async () => '127.0.0.1', fetch: async () => htmlResponse('') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('returns ok=true with meta from successful response', async () => {
    const html = `<html><head><meta property="og:title" content="X"></head></html>`;
    const r = await fetchOgp('https://example.com/', makeOpts({ fetch: async () => htmlResponse(html) }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.title).toBe('X');
  });

  test('returns no_metadata when content-type is not text/html', async () => {
    const r = await fetchOgp(
      'https://example.com/',
      makeOpts({ fetch: async () => htmlResponse('{}', 200, 'application/json') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_metadata');
  });

  test('follows redirect, re-checks host on each hop', async () => {
    let calls = 0;
    const fetcher = async (url: string) => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://final.example.com/' },
        });
      }
      return htmlResponse(`<html><head><title>${url}</title></head></html>`);
    };
    const r = await fetchOgp('https://start.example.com/', makeOpts({ fetch: fetcher }));
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.title).toBe('https://final.example.com/');
  });

  test('blocks redirect target that resolves to a private IP', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://internal.evil/' },
        });
      }
      return htmlResponse('<html></html>');
    };
    const lookup = async (host: string) => (host === 'internal.evil' ? '10.0.0.1' : '8.8.8.8');
    const r = await fetchOgp('https://start.example.com/', makeOpts({ fetch: fetcher, lookup }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('caps total redirects', async () => {
    const fetcher = async () =>
      new Response(null, { status: 302, headers: { location: 'https://next.example.com/' } });
    const r = await fetchOgp('https://start.example.com/', makeOpts({ fetch: fetcher, maxRedirects: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('fetch_failed');
  });

  test('returns timeout when fetch throws AbortError', async () => {
    const fetcher = async () => {
      const e: Error & { name?: string } = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const r = await fetchOgp('https://example.com/', makeOpts({ fetch: fetcher }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: `fetchOgp` describe block fails — symbol not exported.

- [ ] **Step 3: Implement `fetchOgp`**

Append to `src/cli/dashboard/ogp.ts`:

```ts
export type FetchOgpError =
  | 'invalid_url'
  | 'blocked'
  | 'timeout'
  | 'fetch_failed'
  | 'no_metadata';

export type FetchOgpResult =
  | { ok: true; meta: OgpMeta }
  | { ok: false; error: FetchOgpError };

export interface FetchOgpOptions {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  lookup: (hostname: string) => Promise<string>;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

const USER_AGENT = 'Laurel-OGP/1.0 (+laurel)';

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

async function guardHost(url: URL, lookup: FetchOgpOptions['lookup']): Promise<'public' | 'blocked'> {
  if (classifyHost(url.hostname) === 'blocked') return 'blocked';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.includes(':')) {
    // Literal IP — classifyHost already covered it.
    return 'public';
  }
  try {
    const ip = await lookup(url.hostname);
    return classifyResolvedIp(ip);
  } catch {
    return 'blocked';
  }
}

async function readCappedHtml(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(buf);
}

export async function fetchOgp(raw: string, options: FetchOgpOptions): Promise<FetchOgpResult> {
  const startUrl = parseUrl(raw);
  if (!startUrl) return { ok: false, error: 'invalid_url' };

  let current = startUrl;
  let hops = 0;
  while (hops <= options.maxRedirects) {
    const guard = await guardHost(current, options.lookup);
    if (guard === 'blocked') return { ok: false, error: 'blocked' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      const e = err as { name?: string };
      if (e?.name === 'AbortError') return { ok: false, error: 'timeout' };
      return { ok: false, error: 'fetch_failed' };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, error: 'fetch_failed' };
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, error: 'fetch_failed' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, error: 'blocked' };
      }
      current = next;
      hops += 1;
      continue;
    }

    if (response.status >= 400) return { ok: false, error: 'fetch_failed' };

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: false, error: 'no_metadata' };
    }

    const html = await readCappedHtml(response, options.maxBytes);
    const meta = pickMetadata(html, current);
    if (!meta.title && !meta.description && !meta.thumbnail) {
      return { ok: false, error: 'no_metadata' };
    }
    return { ok: true, meta };
  }
  return { ok: false, error: 'fetch_failed' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/dashboard/ogp.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/ogp.ts tests/cli/dashboard/ogp.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add fetchOgp runtime with redirect, timeout, body cap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `POST /api/ogp` route in dashboard server

**Files:**
- Modify: `src/cli/commands/dashboard.ts`

- [ ] **Step 1: Locate the insertion point**

Open `src/cli/commands/dashboard.ts` and find the existing `/api/images` route (`if (request.method === 'POST' && url.pathname === '/api/images')`). The new `/api/ogp` block goes immediately above it, so it shares the same `validateWriteRequest` style.

- [ ] **Step 2: Insert the route**

Add the following block before the `/api/images` `if`:

```ts
if (request.method === 'POST' && url.pathname === '/api/ogp') {
  const blocked = validateWriteRequest(request, ctx.security);
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  const targetUrl = typeof (body as { url?: unknown })?.url === 'string'
    ? ((body as { url: string }).url)
    : '';
  const { lookup } = await import('node:dns/promises');
  const { fetchOgp } = await import('~/cli/dashboard/ogp.ts');
  const result = await fetchOgp(targetUrl, {
    fetch: (u, init) => fetch(u, init),
    lookup: async (host) => {
      const { address } = await lookup(host);
      return address;
    },
    timeoutMs: 5_000,
    maxBytes: 1_000_000,
    maxRedirects: 3,
  });
  return jsonResponse(result, 200);
}
```

Why this shape: failures still return HTTP 200 with `{ ok:false, error }` so the client treats network and SSRF errors uniformly; this is documented in the spec. The route reuses `validateWriteRequest` (csrf token) because issuing arbitrary outbound HTTP is a write-side privilege.

- [ ] **Step 3: Smoke-check the route via a one-off test (no commit yet)**

Run: `bun run check`
Expected: PASS (the additions must lint clean).

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/dashboard.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): expose POST /api/ogp for bookmark metadata fetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Client `fetchOgp` in `api.ts`

**Files:**
- Modify: `src/cli/dashboard/web/lib/api.ts`

- [ ] **Step 1: Add the client wrapper**

Find the `uploadImage` definition in `src/cli/dashboard/web/lib/api.ts` and add immediately below:

```ts
export interface OgpResultMeta {
  url: string;
  title: string;
  description: string;
  icon: string;
  thumbnail: string;
  author: string;
  publisher: string;
}

export type OgpFetchResult =
  | { ok: true; meta: OgpResultMeta }
  | {
      ok: false;
      error: 'invalid_url' | 'blocked' | 'timeout' | 'fetch_failed' | 'no_metadata' | 'request_failed';
    };

export async function fetchOgp(url: string): Promise<OgpFetchResult> {
  const res = await fetch('/api/ogp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-laurel-dashboard-token': TOKEN },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 400) return { ok: false, error: 'request_failed' };
  if (data.ok === true && typeof data.meta === 'object' && data.meta !== null) {
    return { ok: true, meta: data.meta as OgpResultMeta };
  }
  const err = data.error;
  const known = ['invalid_url', 'blocked', 'timeout', 'fetch_failed', 'no_metadata'] as const;
  return { ok: false, error: (known as readonly string[]).includes(err as string) ? (err as OgpFetchResult & { ok: false })['error'] : 'request_failed' };
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/dashboard/web/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add fetchOgp client wrapper for /api/ogp

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Bookmark ProseMirror node spec (pure)

**Files:**
- Create: `src/cli/dashboard/web/lib/prose-bookmark-schema.ts`
- Create: `tests/cli/dashboard/prose-bookmark-schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/cli/dashboard/prose-bookmark-schema.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import {
  BOOKMARK_ATTR_KEYS,
  bookmarkNodeSpec,
} from '../../../src/cli/dashboard/web/lib/prose-bookmark-schema.ts';

const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({ bookmark: bookmarkNodeSpec }),
  marks: basicSchema.spec.marks,
});

describe('bookmarkNodeSpec', () => {
  test('lists the eight attrs', () => {
    expect(BOOKMARK_ATTR_KEYS).toEqual([
      'url', 'title', 'description', 'icon',
      'thumbnail', 'author', 'publisher', 'caption',
    ]);
  });

  test('creates a node with default empty attrs', () => {
    const node = schema.nodes.bookmark.create();
    for (const key of BOOKMARK_ATTR_KEYS) {
      expect(node.attrs[key]).toBe('');
    }
  });

  test('round-trips attrs via create', () => {
    const node = schema.nodes.bookmark.create({
      url: 'https://example.com/',
      title: 'T',
      description: 'D',
      icon: 'https://example.com/favicon.ico',
      thumbnail: 'https://example.com/og.png',
      author: 'A',
      publisher: 'P',
      caption: 'C',
    });
    expect(node.attrs.url).toBe('https://example.com/');
    expect(node.attrs.caption).toBe('C');
  });

  test('is a block atom (no inner content)', () => {
    expect(schema.nodes.bookmark.spec.atom).toBe(true);
    expect(schema.nodes.bookmark.isAtom).toBe(true);
    expect(schema.nodes.bookmark.isBlock).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/dashboard/prose-bookmark-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the node spec**

Create `src/cli/dashboard/web/lib/prose-bookmark-schema.ts`:

```ts
import type { NodeSpec } from 'prosemirror-model';

export const BOOKMARK_ATTR_KEYS = [
  'url',
  'title',
  'description',
  'icon',
  'thumbnail',
  'author',
  'publisher',
  'caption',
] as const;

export type BookmarkAttrKey = (typeof BOOKMARK_ATTR_KEYS)[number];

export type BookmarkAttrs = { [K in BookmarkAttrKey]: string };

function emptyAttrs(): Record<BookmarkAttrKey, { default: string }> {
  return Object.fromEntries(BOOKMARK_ATTR_KEYS.map((k) => [k, { default: '' }])) as Record<
    BookmarkAttrKey,
    { default: string }
  >;
}

export const bookmarkNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: emptyAttrs(),
  // The NodeView replaces toDOM in the editor. We keep a minimal
  // fallback DOM so prosemirror-model's invariants are satisfied and
  // copy/paste between editors works at all.
  toDOM(node) {
    return [
      'figure',
      { class: 'kg-card kg-bookmark-card', 'data-url': String(node.attrs.url ?? '') },
      ['a', { class: 'kg-bookmark-container', href: String(node.attrs.url ?? '') }, ''],
    ];
  },
  parseDOM: [
    {
      tag: 'figure.kg-card.kg-bookmark-card',
      getAttrs(dom) {
        if (!(dom instanceof HTMLElement)) return false;
        const anchor = dom.querySelector('a.kg-bookmark-container');
        const url = anchor?.getAttribute('href') ?? '';
        const title = dom.querySelector('.kg-bookmark-title')?.textContent ?? '';
        const description = dom.querySelector('.kg-bookmark-description')?.textContent ?? '';
        const author = dom.querySelector('.kg-bookmark-author')?.textContent ?? '';
        const publisher = dom.querySelector('.kg-bookmark-publisher')?.textContent ?? '';
        const icon = dom.querySelector('.kg-bookmark-icon')?.getAttribute('src') ?? '';
        const thumbnail =
          dom.querySelector('.kg-bookmark-thumbnail img')?.getAttribute('src') ?? '';
        const caption = dom.querySelector('figcaption')?.textContent ?? '';
        return { url, title, description, icon, thumbnail, author, publisher, caption };
      },
    },
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/dashboard/prose-bookmark-schema.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/web/lib/prose-bookmark-schema.ts tests/cli/dashboard/prose-bookmark-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add bookmark prose node spec

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Bookmark markdown parser + serializer (pure, round-trip)

**Files:**
- Create: `src/cli/dashboard/web/lib/prose-bookmark-markdown.ts`
- Create: `tests/cli/dashboard/prose-bookmark-markdown.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/cli/dashboard/prose-bookmark-markdown.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { bookmarkNodeSpec } from '../../../src/cli/dashboard/web/lib/prose-bookmark-schema.ts';
import {
  bookmarkMarkdownItPlugin,
  bookmarkSerializerNode,
  bookmarkTokenHandler,
} from '../../../src/cli/dashboard/web/lib/prose-bookmark-markdown.ts';

const schema = new Schema({
  nodes: basicSchema.spec.nodes.append({ bookmark: bookmarkNodeSpec }),
  marks: basicSchema.spec.marks,
});

const md = MarkdownIt('commonmark', { html: false }).use(bookmarkMarkdownItPlugin);
const parser = new MarkdownParser(schema, md, {
  ...defaultMarkdownParser.tokens,
  bookmark: bookmarkTokenHandler,
});
const serializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, bookmark: bookmarkSerializerNode },
  defaultMarkdownSerializer.marks,
);

const FULL = `{{< bookmark url="https://example.com/post" title="Hello" description="Desc" icon="https://example.com/favicon.ico" thumbnail="https://example.com/og.png" author="A" publisher="P" caption="C" />}}`;

describe('bookmark markdown bridge', () => {
  test('parses a full-attr shortcode into a bookmark node', () => {
    const doc = parser.parse(FULL);
    expect(doc).not.toBeNull();
    const node = doc?.firstChild;
    expect(node?.type.name).toBe('bookmark');
    expect(node?.attrs.url).toBe('https://example.com/post');
    expect(node?.attrs.title).toBe('Hello');
    expect(node?.attrs.caption).toBe('C');
  });

  test('serialises a bookmark node back to the same shortcode (round-trip)', () => {
    const doc = parser.parse(FULL);
    expect(doc).not.toBeNull();
    if (!doc) return;
    const out = serializer.serialize(doc).trim();
    expect(out).toBe(FULL);
  });

  test('omits empty attrs when serialising', () => {
    const node = schema.nodes.bookmark.create({
      url: 'https://example.com/',
      title: 'T',
      description: '',
      icon: '',
      thumbnail: '',
      author: '',
      publisher: '',
      caption: '',
    });
    const doc = schema.node('doc', null, [node]);
    const out = serializer.serialize(doc).trim();
    expect(out).toBe('{{< bookmark url="https://example.com/" title="T" />}}');
  });

  test('round-trips embedded quotes via backslash escaping', () => {
    const md1 = `{{< bookmark url="https://example.com/" title="He said \\"hi\\"" />}}`;
    const doc = parser.parse(md1);
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc.firstChild?.attrs.title).toBe('He said "hi"');
    const out = serializer.serialize(doc).trim();
    expect(out).toBe(md1);
  });

  test('does not treat ordinary paragraphs starting with `{` as bookmarks', () => {
    const doc = parser.parse('{not a bookmark}');
    expect(doc?.firstChild?.type.name).toBe('paragraph');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/dashboard/prose-bookmark-markdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bridge**

Create `src/cli/dashboard/web/lib/prose-bookmark-markdown.ts`:

```ts
import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token';
import type { Node as ProseNode } from 'prosemirror-model';
import type { MarkdownSerializerState } from 'prosemirror-markdown';
import { BOOKMARK_ATTR_KEYS, type BookmarkAttrs } from './prose-bookmark-schema.ts';

const BOOKMARK_LINE = /^\{\{<\s+bookmark((?:\s+[a-zA-Z][\w-]*="(?:\\.|[^"\\])*")*)\s*\/>\}\}\s*$/;
const ATTR_RE = /([a-zA-Z][\w-]*)="((?:\\.|[^"\\])*)"/g;

function unescapeAttr(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

function escapeAttr(value: string): string {
  return value.replace(/(["\\])/g, '\\$1');
}

function parseAttrs(attrText: string): BookmarkAttrs {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrText)) !== null) {
    const key = m[1];
    const raw = m[2];
    if (!key || raw === undefined) continue;
    attrs[key] = unescapeAttr(raw);
  }
  const out: BookmarkAttrs = {
    url: '',
    title: '',
    description: '',
    icon: '',
    thumbnail: '',
    author: '',
    publisher: '',
    caption: '',
  };
  for (const k of BOOKMARK_ATTR_KEYS) {
    const v = attrs[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function bookmarkMarkdownItPlugin(md: MarkdownIt): void {
  md.block.ruler.before(
    'paragraph',
    'bookmark',
    (state, startLine, _endLine, silent) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(pos, max);
      const match = BOOKMARK_LINE.exec(line);
      if (!match) return false;
      if (silent) return true;
      const attrText = match[1] ?? '';
      const token: Token = state.push('bookmark', '', 0);
      token.markup = '{{< bookmark />}}';
      token.block = true;
      token.map = [startLine, startLine + 1];
      token.meta = { attrs: parseAttrs(attrText) };
      state.line = startLine + 1;
      return true;
    },
    { alt: [] },
  );
}

export const bookmarkTokenHandler = {
  node: 'bookmark',
  getAttrs(tok: Token): BookmarkAttrs {
    const meta = tok.meta as { attrs?: BookmarkAttrs } | null;
    return (
      meta?.attrs ?? {
        url: '',
        title: '',
        description: '',
        icon: '',
        thumbnail: '',
        author: '',
        publisher: '',
        caption: '',
      }
    );
  },
};

export function bookmarkSerializerNode(state: MarkdownSerializerState, node: ProseNode): void {
  const pairs: string[] = [];
  for (const key of BOOKMARK_ATTR_KEYS) {
    const value = String(node.attrs[key] ?? '');
    if (!value) continue;
    pairs.push(`${key}="${escapeAttr(value)}"`);
  }
  const body = pairs.length > 0 ? ` ${pairs.join(' ')} ` : ' ';
  state.write(`{{< bookmark${body}/>}}`);
  state.closeBlock(node);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/dashboard/prose-bookmark-markdown.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/web/lib/prose-bookmark-markdown.ts tests/cli/dashboard/prose-bookmark-markdown.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add bookmark markdown parser/serializer bridge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire bookmark schema + markdown bridge into ProseEditor

**Files:**
- Modify: `src/cli/dashboard/web/components/ProseEditor.tsx`

- [ ] **Step 1: Extend the schema with the bookmark node**

Open `src/cli/dashboard/web/components/ProseEditor.tsx`. Locate the block that builds `fullNodes` (`const withList = addListNodes(baseNodes, …); const fullNodes = withList.append(tableNodes(…));`).

Add **before** the `proseSchema` declaration:

```ts
import { bookmarkNodeSpec } from '../lib/prose-bookmark-schema.ts';
import {
  bookmarkMarkdownItPlugin,
  bookmarkSerializerNode,
  bookmarkTokenHandler,
} from '../lib/prose-bookmark-markdown.ts';

const fullNodesWithBookmark = fullNodes.append({ bookmark: bookmarkNodeSpec });
```

Change:

```ts
export const proseSchema = new Schema({
  nodes: fullNodes,
  marks: extendedMarks,
});
```

to:

```ts
export const proseSchema = new Schema({
  nodes: fullNodesWithBookmark,
  marks: extendedMarks,
});
```

- [ ] **Step 2: Register the bookmark token in the parser**

Inside `parserTokens`, add:

```ts
const parserTokens = {
  ...defaultMarkdownParser.tokens,
  // … existing entries …
  bookmark: bookmarkTokenHandler,
};
```

Change the `markdownTokenizer` construction to install the bookmark block rule:

```ts
const markdownTokenizer = MarkdownIt('commonmark', { html: false })
  .enable(['table'])
  .use(bookmarkMarkdownItPlugin);
```

- [ ] **Step 3: Register the bookmark serializer node**

In the `markdownSerializer` constructor, add a `bookmark` entry next to `table`:

```ts
export const markdownSerializer = new MarkdownSerializer(
  {
    ...baseSerializer.nodes,
    table(state, n) { /* unchanged */ },
    table_row() {},
    table_header() {},
    table_cell() {},
    bookmark: bookmarkSerializerNode,
  },
  /* marks unchanged */
);
```

- [ ] **Step 4: Run typecheck and existing tests**

Run: `bun run check && bun test tests/cli/dashboard/`
Expected: PASS. Existing prose-insert-menu tests continue to pass because the bookmark node is purely additive.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/web/components/ProseEditor.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): wire bookmark node + markdown bridge into ProseEditor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `validateBookmarkUrl` in insert-menu logic

**Files:**
- Modify: `src/cli/dashboard/web/lib/prose-insert-menu-logic.ts`
- Modify: `tests/cli/dashboard/prose-insert-menu.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/cli/dashboard/prose-insert-menu.test.ts`:

```ts
import { validateBookmarkUrl } from '../../../src/cli/dashboard/web/lib/prose-insert-menu-logic.ts';

describe('validateBookmarkUrl', () => {
  test('accepts https URLs and returns the canonical form', () => {
    const r = validateBookmarkUrl('  https://example.com/x  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('https://example.com/x');
  });

  test('accepts http URLs', () => {
    expect(validateBookmarkUrl('http://example.com').ok).toBe(true);
  });

  test('rejects empty input', () => {
    const r = validateBookmarkUrl('   ');
    expect(r.ok).toBe(false);
  });

  test('rejects non-http schemes', () => {
    expect(validateBookmarkUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateBookmarkUrl('ftp://example.com').ok).toBe(false);
  });

  test('rejects strings that do not parse as URLs', () => {
    expect(validateBookmarkUrl('not a url').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/dashboard/prose-insert-menu.test.ts`
Expected: new describe FAILs — symbol missing.

- [ ] **Step 3: Implement `validateBookmarkUrl`**

Append to `src/cli/dashboard/web/lib/prose-insert-menu-logic.ts`:

```ts
export type ValidateBookmarkUrlResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateBookmarkUrl(raw: string): ValidateBookmarkUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Enter a URL' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid http(s) URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs are supported' };
  }
  return { ok: true, value: url.toString() };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cli/dashboard/prose-insert-menu.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/web/lib/prose-insert-menu-logic.ts tests/cli/dashboard/prose-insert-menu.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add validateBookmarkUrl for the bookmark input view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Insert-menu Bookmark item with inline URL input view

**Files:**
- Modify: `src/cli/dashboard/web/lib/prose-insert-menu.ts`

- [ ] **Step 1: Extend `MenuItemSpec` with an inputView shape**

At the top of `src/cli/dashboard/web/lib/prose-insert-menu.ts`, add a new optional shape next to `submenu`:

```ts
interface InputViewSpec {
  placeholder: string;
  buttonLabel: string;
  validate(value: string): { ok: true; value: string } | { ok: false; error: string };
  run(
    view: EditorView,
    schema: Schema,
    target: EmptyParagraphTarget,
    value: string,
  ): Promise<{ ok: boolean; error?: string }>;
}

interface MenuItemSpec {
  key: string;
  label: string;
  hint: string;
  enabled: (schema: Schema, options: InsertMenuOptions) => boolean;
  submenu?: (options: InsertMenuOptions) => SubmenuEntry[];
  inputView?: (options: InsertMenuOptions) => InputViewSpec;
  run?: (
    view: EditorView,
    schema: Schema,
    target: EmptyParagraphTarget,
    options: InsertMenuOptions,
    ui: { fileInput: HTMLInputElement; close: () => void },
  ) => void;
}
```

- [ ] **Step 2: Add Bookmark item**

Add to the existing `InsertMenuOptions`:

```ts
export interface InsertMenuOptions {
  uploadImage?: (file: File) => Promise<InsertMenuUploadResult>;
  altFromFilename?: (name: string) => string;
  getComponents?: () => ComponentEntry[];
  fetchOgp?: (url: string) => Promise<
    | { ok: true; meta: Record<string, string> }
    | { ok: false; error: string }
  >;
}
```

Then insert the Bookmark entry into `MENU_ITEMS`, placed second (right after Image) so authors see it before structural items:

```ts
{
  key: 'bookmark',
  label: 'Bookmark',
  hint: 'Embed a URL as a rich link card',
  enabled: (schema, options) => Boolean(options.fetchOgp) && Boolean(nodeBy(schema, 'bookmark')),
  inputView: (options) => ({
    placeholder: 'Paste or type a URL',
    buttonLabel: 'Embed',
    validate(value) {
      // Re-implemented inline (no DOM dep so it stays pure here).
      const trimmed = value.trim();
      if (!trimmed) return { ok: false, error: 'Enter a URL' };
      try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return { ok: false, error: 'Only http(s) URLs are supported' };
        }
        return { ok: true, value: u.toString() };
      } catch {
        return { ok: false, error: 'Enter a valid http(s) URL' };
      }
    },
    async run(view, schema, target, value) {
      const bookmark = nodeBy(schema, 'bookmark');
      if (!bookmark) return { ok: false, error: 'Bookmark node not registered' };
      const fetcher = options.fetchOgp;
      if (!fetcher) {
        replaceEmptyParagraph(view, target, bookmark.create({ url: value }));
        return { ok: false, error: 'No OGP fetcher configured' };
      }
      const result = await fetcher(value);
      if (result.ok) {
        replaceEmptyParagraph(view, target, bookmark.create({ url: value, ...result.meta }));
        return { ok: true };
      }
      replaceEmptyParagraph(view, target, bookmark.create({ url: value }));
      const messages: Record<string, string> = {
        invalid_url: 'Enter a valid http(s) URL',
        blocked: 'Cannot preview this URL',
        timeout: 'Preview timed out — inserted URL only',
        fetch_failed: 'Could not fetch — inserted URL only',
        no_metadata: 'No preview available — inserted URL only',
      };
      return { ok: false, error: messages[result.error] ?? 'Could not fetch — inserted URL only' };
    },
  }),
},
```

- [ ] **Step 3: Render the input view in the popover**

Inside the `view(view)` lifecycle of `insertMenuPlugin`, after `const itemButtons …` and before the submenu DOM, add an input view container:

```ts
const inputView = document.createElement('div');
inputView.className = 'proseInsertInputView';
inputView.hidden = true;
const inputLabel = document.createElement('input');
inputLabel.type = 'url';
inputLabel.className = 'proseInsertInputField';
const inputSubmit = document.createElement('button');
inputSubmit.type = 'button';
inputSubmit.className = 'proseInsertInputSubmit';
const inputError = document.createElement('div');
inputError.className = 'proseInsertInputError';
inputError.setAttribute('role', 'alert');
inputView.appendChild(inputLabel);
inputView.appendChild(inputSubmit);
inputView.appendChild(inputError);
popover.appendChild(inputView);

let inputViewOpenKey: string | null = null;

function openInputView(itemKey: string, spec: InputViewSpec): void {
  inputViewOpenKey = itemKey;
  inputLabel.value = '';
  inputLabel.placeholder = spec.placeholder;
  inputSubmit.textContent = spec.buttonLabel;
  inputSubmit.disabled = false;
  inputLabel.disabled = false;
  inputError.textContent = '';
  inputView.hidden = false;
  for (const btn of itemButtons) {
    btn.hidden = true;
  }
  setTimeout(() => inputLabel.focus(), 0);
}

function closeInputView(): void {
  if (inputViewOpenKey === null) return;
  inputViewOpenKey = null;
  inputView.hidden = true;
  // Restore items list. The next call to update() will recompute hidden state.
  update(view);
}

async function submitInputView(): Promise<void> {
  if (inputViewOpenKey === null) return;
  const item = MENU_ITEMS.find((i) => i.key === inputViewOpenKey);
  const spec = item?.inputView?.(opts);
  if (!spec || !currentTarget) {
    closeInputView();
    return;
  }
  const validation = spec.validate(inputLabel.value);
  if (!validation.ok) {
    inputError.textContent = validation.error;
    return;
  }
  inputError.textContent = '';
  inputLabel.disabled = true;
  inputSubmit.disabled = true;
  const result = await spec.run(view, schema, currentTarget, validation.value);
  inputLabel.disabled = false;
  inputSubmit.disabled = false;
  if (result.ok) {
    closeInputView();
    closePopover();
    view.focus();
    return;
  }
  // Failure inserted URL-only — close the popover but keep the error
  // in the trigger title for a moment so users see the reason.
  closeInputView();
  closePopover();
  view.focus();
  if (result.error) {
    const previous = trigger.title;
    trigger.title = result.error;
    setTimeout(() => {
      if (trigger.title === result.error) trigger.title = previous;
    }, 4000);
  }
}

inputSubmit.addEventListener('mousedown', (event) => event.preventDefault());
inputSubmit.addEventListener('click', (event) => {
  event.preventDefault();
  void submitInputView();
});
inputLabel.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitInputView();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeInputView();
  }
});
```

- [ ] **Step 4: Hook the new `inputView` shape into item-button clicks**

Inside the existing `btn.addEventListener('click', …)` loop, before the `submenu` branch:

```ts
if (item.inputView) {
  const spec = item.inputView(opts);
  openInputView(item.key, spec);
  return;
}
```

Also extend `closePopover()` to call `closeInputView()` so re-opening the menu starts clean.

- [ ] **Step 5: Run typecheck**

Run: `bun run check && bun test tests/cli/dashboard/prose-insert-menu.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/dashboard/web/lib/prose-insert-menu.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add Bookmark item with inline URL input to + menu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Bookmark NodeView (DOM rendering, Replace / Remove, caption)

**Files:**
- Create: `src/cli/dashboard/web/lib/prose-bookmark-view.ts`
- Modify: `src/cli/dashboard/web/components/ProseEditor.tsx`

- [ ] **Step 1: Create the NodeView class**

Create `src/cli/dashboard/web/lib/prose-bookmark-view.ts`:

```ts
import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export interface BookmarkNodeViewOptions {
  // Called when the user clicks "Replace". The runtime should open the
  // insert-menu URL input view anchored to this node; we keep the
  // coupling shallow by exposing a single callback.
  onReplace?: (pos: number, node: ProseNode) => void;
}

export class BookmarkNodeView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly options: BookmarkNodeViewOptions;
  private readonly card: HTMLElement;
  private readonly captionInput: HTMLInputElement;
  private readonly actions: HTMLElement;

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    options: BookmarkNodeViewOptions = {},
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;

    const figure = document.createElement('figure');
    figure.className = 'proseBookmarkFigure';
    this.dom = figure;

    this.card = document.createElement('div');
    this.card.className = 'proseBookmarkCard';
    figure.appendChild(this.card);

    this.captionInput = document.createElement('input');
    this.captionInput.type = 'text';
    this.captionInput.className = 'proseBookmarkCaption';
    this.captionInput.placeholder = 'Type caption (optional)';
    this.captionInput.addEventListener('input', () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        caption: this.captionInput.value,
      });
      this.view.dispatch(tr);
    });
    figure.appendChild(this.captionInput);

    this.actions = document.createElement('div');
    this.actions.className = 'proseBookmarkActions';
    this.actions.hidden = true;
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'proseBookmarkAction';
    replaceBtn.textContent = 'Replace';
    replaceBtn.addEventListener('mousedown', (e) => e.preventDefault());
    replaceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      options.onReplace?.(pos, this.node);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'proseBookmarkAction';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      this.view.dispatch(tr);
    });
    this.actions.appendChild(replaceBtn);
    this.actions.appendChild(removeBtn);
    figure.appendChild(this.actions);

    this.renderCard();
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderCard();
    if (this.captionInput.value !== String(node.attrs.caption ?? '')) {
      this.captionInput.value = String(node.attrs.caption ?? '');
    }
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('proseBookmarkFigure--selected');
    this.actions.hidden = false;
  }

  deselectNode(): void {
    this.dom.classList.remove('proseBookmarkFigure--selected');
    this.actions.hidden = true;
  }

  stopEvent(event: Event): boolean {
    return event.target === this.captionInput;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // Nothing else to release — listeners are bound to elements owned by `dom`.
  }

  private renderCard(): void {
    const url = String(this.node.attrs.url ?? '');
    const title = String(this.node.attrs.title ?? '') || url;
    const description = String(this.node.attrs.description ?? '');
    const icon = String(this.node.attrs.icon ?? '');
    const thumbnail = String(this.node.attrs.thumbnail ?? '');
    const publisher = String(this.node.attrs.publisher ?? '');
    const author = String(this.node.attrs.author ?? '');

    const content = document.createElement('a');
    content.className = 'proseBookmarkLink';
    content.href = url || '#';
    content.target = '_blank';
    content.rel = 'noreferrer noopener';

    const text = document.createElement('div');
    text.className = 'proseBookmarkText';
    const titleEl = document.createElement('div');
    titleEl.className = 'proseBookmarkTitle';
    titleEl.textContent = title;
    text.appendChild(titleEl);
    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'proseBookmarkDescription';
      descEl.textContent = description;
      text.appendChild(descEl);
    }
    const meta = document.createElement('div');
    meta.className = 'proseBookmarkMeta';
    if (icon) {
      const iconImg = document.createElement('img');
      iconImg.className = 'proseBookmarkIcon';
      iconImg.src = icon;
      iconImg.alt = '';
      meta.appendChild(iconImg);
    }
    const metaText = document.createElement('span');
    metaText.className = 'proseBookmarkMetaText';
    metaText.textContent = [publisher, author].filter(Boolean).join(' · ');
    meta.appendChild(metaText);
    text.appendChild(meta);
    content.appendChild(text);

    if (thumbnail) {
      const thumb = document.createElement('img');
      thumb.className = 'proseBookmarkThumbnail';
      thumb.src = thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      content.appendChild(thumb);
    }

    this.card.replaceChildren(content);
  }
}
```

- [ ] **Step 2: Register the NodeView and Replace callback in `ProseEditor.tsx`**

In `ProseEditor.tsx`, find the existing `nodeViews:` map and the place where `insertMenuPlugin` is constructed. Extend both:

```ts
import { BookmarkNodeView } from '../lib/prose-bookmark-view.ts';
import { fetchOgp } from '../lib/api.ts';
```

Inside the `EditorView` setup:

```ts
nodeViews: {
  image: (n, v, getPos) => new ImageNodeView(n, v, getPos),
  bookmark: (n, v, getPos) =>
    new BookmarkNodeView(n, v, getPos, {
      onReplace(pos, node) {
        // Trigger the insert-menu's URL input view anchored to this node.
        // Replacement is implemented in two steps: drop the bookmark to
        // an empty paragraph, then let the user re-run the bookmark
        // item from the + menu. This keeps the popover / SSRF path
        // exactly one source of truth.
        const tr = v.state.tr.replaceWith(
          pos,
          pos + node.nodeSize,
          v.state.schema.nodes.paragraph.create(),
        );
        v.dispatch(tr);
        v.focus();
      },
    }),
},
```

Update the `insertMenuPlugin` construction to pass `fetchOgp`:

```ts
insertMenuPlugin(proseSchema, {
  uploadImage,
  // … existing options …
  fetchOgp: async (url) => {
    const r = await fetchOgp(url);
    if (r.ok) {
      const { url: _u, ...rest } = r.meta;
      return { ok: true, meta: { ...rest } };
    }
    return { ok: false, error: r.error };
  },
}),
```

(Adapt argument order to wherever insertMenuPlugin is currently constructed.)

- [ ] **Step 3: Run typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/dashboard/web/lib/prose-bookmark-view.ts src/cli/dashboard/web/components/ProseEditor.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): add bookmark NodeView with Replace/Remove/caption

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Styles for bookmark card + input view

**Files:**
- Modify: `src/cli/dashboard/web/styles.css`

- [ ] **Step 1: Append styles**

Append to `src/cli/dashboard/web/styles.css` (inside the same `@media` block that already houses `.proseInsertItem` — i.e., after `.proseInsertFileInput { display: none; }`):

```css
  .proseInsertInputView {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    min-width: 240px;
  }
  .proseInsertInputView[hidden] {
    display: none;
  }
  .proseInsertInputField {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
    border-radius: 6px;
    background: var(--surface-card, #fff);
    color: var(--text-primary, #1a1612);
  }
  .proseInsertInputField:focus-visible {
    outline: 2px solid var(--text-primary, #1a1612);
    outline-offset: 1px;
  }
  .proseInsertInputSubmit {
    align-self: flex-end;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--text-primary, #1a1612);
    background: var(--text-primary, #1a1612);
    color: var(--text-invert, #f4ecd9);
    font: inherit;
    cursor: pointer;
  }
  .proseInsertInputSubmit[disabled] {
    opacity: 0.6;
    cursor: progress;
  }
  .proseInsertInputError {
    font-size: 12px;
    color: var(--text-danger, #b3261e);
    min-height: 14px;
  }

  .proseBookmarkFigure {
    margin: 1.5em 0;
    position: relative;
  }
  .proseBookmarkFigure--selected .proseBookmarkCard {
    outline: 2px solid var(--text-primary, #1a1612);
    outline-offset: 2px;
  }
  .proseBookmarkCard {
    border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
    border-radius: 8px;
    background: var(--surface-card, #fff);
    overflow: hidden;
  }
  .proseBookmarkLink {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0;
    color: inherit;
    text-decoration: none;
  }
  .proseBookmarkText {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .proseBookmarkTitle {
    font-weight: 600;
    color: var(--text-primary, #1a1612);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proseBookmarkDescription {
    color: var(--text-muted, #6b6258);
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .proseBookmarkMeta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted, #6b6258);
  }
  .proseBookmarkIcon {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }
  .proseBookmarkThumbnail {
    width: 144px;
    height: auto;
    object-fit: cover;
    align-self: stretch;
  }
  .proseBookmarkCaption {
    margin-top: 6px;
    width: 100%;
    font: inherit;
    font-size: 13px;
    border: 0;
    border-bottom: 1px dashed var(--border-default, rgba(0, 0, 0, 0.18));
    background: transparent;
    text-align: center;
    color: var(--text-muted, #6b6258);
  }
  .proseBookmarkCaption:focus-visible {
    outline: none;
    border-bottom-color: var(--text-primary, #1a1612);
    color: var(--text-primary, #1a1612);
  }
  .proseBookmarkActions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    background: var(--surface-card, #fff);
    border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
    border-radius: 6px;
    padding: 2px;
  }
  .proseBookmarkActions[hidden] {
    display: none;
  }
  .proseBookmarkAction {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .proseBookmarkAction:hover {
    background: var(--surface-hover, rgba(0, 0, 0, 0.04));
  }
```

- [ ] **Step 2: Visual sanity check**

Skim the file to confirm the new block sits inside the same media query / dashboard-scope wrapper as `.proseInsertItem`. If `.proseInsertItem` is inside a `.proseHost { … }` or `@media` block, the new styles must share that scope.

- [ ] **Step 3: Run check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli/dashboard/web/styles.css
git commit -m "$(cat <<'EOF'
feat(dashboard): style bookmark card and insert-menu input view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Local-CI sweep + manual verify in the editor

**Files:** none (verification only)

- [ ] **Step 1: Run the local CI surface**

Run from the worktree root:

```bash
/run-github-actions-locally
```

Or, if running the skill is unavailable, run these directly:

```bash
bun run check
bun test
```

Expected: green. Fix any breakage on the spot and re-commit with a `fix:` message.

- [ ] **Step 2: Manual editor verification**

Run the dashboard against the example site:

```bash
cd example && bun ../src/cli/index.ts dashboard --port 4322
```

In a browser, open a post in the editor and:

- Place the caret on an empty paragraph → the `+` button shows up.
- Click `+` → see **Bookmark** as the second item.
- Click Bookmark → input field shows; type `https://anthropic.com`, press Enter → server fetches, the bookmark card appears.
- Type a nonsense URL (e.g. `not a url`) → error appears below the input.
- Type a `localhost` URL → URL-only bookmark gets inserted, error toast on `+` trigger title.
- Save and reopen the post → bookmark survives the markdown round-trip.
- Click the bookmark → Replace / Remove buttons appear; caption input editable.

If anything fails, file a new task and pause this checklist.

- [ ] **Step 3: Final commit if any tweaks were needed**

If you adjusted anything during the manual sweep, commit it with `fix(dashboard): …` and re-run `/run-github-actions-locally`.

---

## Task 14: Open the PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feature/editor-bookmark-card-insert
```

- [ ] **Step 2: Launch `/pr-complete`**

Hand the PR creation, CI watch, and review cycle to the `/pr-complete` skill from this worktree. Do not local-merge.

---

## Self-review notes

- All spec sections are covered by Tasks 1–12 (parser/serializer, schema, NodeView, OGP server, OGP client, + menu UI, CSS). Tasks 13 and 14 cover verification and shipping.
- No `TBD` / placeholder steps. Every code block is complete and self-contained.
- Type names line up across tasks: `BOOKMARK_ATTR_KEYS`, `bookmarkNodeSpec`, `bookmarkMarkdownItPlugin`, `bookmarkTokenHandler`, `bookmarkSerializerNode`, `BookmarkNodeView`, `fetchOgp` (client + server), `OgpFetchResult`, `FetchOgpResult`.
- `validateBookmarkUrl` exists in two places: the pure exported helper in `prose-insert-menu-logic.ts` (consumed by tests) and an inline duplicate inside the bookmark `inputView` spec (consumed by the plugin so it does not have to import its own logic module twice). This is intentional and called out in the spec.
- The Replace flow drops the bookmark back to an empty paragraph and relies on the user re-running the `+` menu Bookmark item. We keep the popover / SSRF path as the single source of truth rather than building a second URL input ad hoc.
