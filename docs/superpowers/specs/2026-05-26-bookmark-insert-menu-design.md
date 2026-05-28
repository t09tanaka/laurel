# Bookmark Card Insertion in the Post/Page Editor

Status: design accepted, ready for implementation plan
Date: 2026-05-26
Branch: feature/editor-bookmark-card-insert

## Problem

The nectar dashboard's WYSIWYG editor (ProseMirror) exposes a Ghost
Koenig-style `+` menu on empty top-level paragraphs
(`src/cli/dashboard/web/lib/prose-insert-menu.ts`). It currently offers
Image / Divider / Code block / Table / Components. There is no way to
insert a **bookmark card** — the rich link preview Ghost calls a
"Bookmark" in its + menu.

The rendering half is already done:

- `src/content/markdown.ts:629` parses `{{< bookmark url="..." title="..." description="..." icon="..." thumbnail="..." author="..." publisher="..." caption="..." />}}` and expands it into the Ghost-compatible `<figure class="kg-card kg-bookmark-card">…</figure>` markup that Source/Casper themes target.
- `src/ghost/turndown-rules.ts:494` already reverses Ghost exports back into that shortcode at import time.
- Schema validation lists `bookmark` with `url` required (`src/content/markdown.ts:710`).

What is missing is the **editor-side insertion path** so authors can
create bookmark cards without hand-typing the shortcode.

## Goal

Authors clicking the `+` menu can pick **Bookmark**, paste a URL, and
see a populated card inline in the editor. The card serialises to the
existing `{{< bookmark ... />}}` shortcode so the build pipeline is
unchanged.

## Non-goals

- oEmbed (Twitter / YouTube / Spotify cards) — already covered by `{{< embed >}}`, not in scope here.
- Persistent OGP cache (`.nectar/cache/ogp/`) — future work.
- Self-hosting fetched thumbnails into `content/images/` — future work; we keep external URLs.
- A standalone "card link copy" route.
- Retry UI on fetch failure beyond the existing "Replace" affordance.

## Architecture

```
[Editor: ProseEditor.tsx]
  └─ prose-insert-menu adds "Bookmark" item
       └─ click → inline URL input view in the popover
            └─ Enter → POST /api/ogp { url }
                 ├─ ok=true  → insert bookmark node with full attrs
                 └─ ok=false → insert bookmark node with only url + inline error

[ProseMirror schema: prose-bookmark-schema.ts (new)]
  └─ block atom node "bookmark" with attrs
  └─ NodeView (prose-bookmark-view.ts) renders the card and Replace/Remove actions

[Markdown bridge: prose-bookmark-markdown.ts (new, pure)]
  └─ markdown-it block rule:  {{< bookmark … />}}  → bookmark token
  └─ MarkdownSerializer:      bookmark node       → {{< bookmark … />}} line

[Server: src/cli/commands/dashboard.ts]
  └─ POST /api/ogp handler
       ├─ validateWriteRequest (existing)
       ├─ SSRF guard (scheme + hostname + resolved IP, repeated per redirect)
       ├─ Bun.fetch with manual redirect, 5s timeout, 1MB body cap
       ├─ htmlparser2 → <meta>/<title>/<link rel=icon>
       └─ jsonResponse({ ok, meta })

[Build pipeline]
  └─ Unchanged. src/content/markdown.ts already expands the shortcode.
```

## Components

### 1. ProseMirror node + NodeView

`src/cli/dashboard/web/lib/prose-bookmark-schema.ts` (new, pure)

```ts
export const BOOKMARK_ATTR_KEYS = [
  'url', 'title', 'description', 'icon',
  'thumbnail', 'author', 'publisher', 'caption',
] as const;

export const bookmarkNodeSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  attrs: Object.fromEntries(BOOKMARK_ATTR_KEYS.map(k => [k, { default: '' }])),
  parseDOM: [{ tag: 'figure.kg-card.kg-bookmark-card', getAttrs }],
  toDOM(node) { /* fallback DOM — NodeView replaces in practice */ },
};
```

`ProseEditor.tsx` appends `bookmark: bookmarkNodeSpec` to `fullNodes`
before constructing `proseSchema`.

`src/cli/dashboard/web/lib/prose-bookmark-view.ts` (new, DOM-side):
follows the pattern of `prose-image-view.ts`. Layout:

```
┌──────────────────────────────────────────────┐
│ [title]                              ─────── │
│ [description (clamped to 2 lines)]   │ img │
│ [icon] publisher · author            ─────── │
└──────────────────────────────────────────────┘
[caption input, placeholder "Type caption (optional)"]
[Replace] [Remove]                       (shown when selected only)
```

- caption is a contenteditable span that dispatches a `tr.setNodeMarkup` like the image NodeView's alt edit.
- `[Replace]` re-opens the URL input popover anchored to this node; on submit it `replaceWith`s the node.
- `[Remove]` deletes the node and parks the cursor at the resulting position.

### 2. Markdown bridge

`src/cli/dashboard/web/lib/prose-bookmark-markdown.ts` (new, pure):

- **Parser**: a markdown-it block rule registered before `paragraph` that consumes a single line beginning with `{{< bookmark ` and ending with `/>}}`. Attribute extraction reuses the same regex shape as `src/content/markdown.ts:629` (`name="value"` with `\\.` escape support). Produces a `bookmark` token whose `meta.attrs` carries the attrs map.
- **prosemirror-markdown bridge**: `BOOKMARK_TOKEN_HANDLER = { node: 'bookmark', getAttrs(tok) { return normaliseAttrs(tok.meta.attrs); } }`.
- **Serializer**: iterates `BOOKMARK_ATTR_KEYS` in fixed order, emits only non-empty attrs, escapes `"` and `\\` to keep round-trip stable, writes one line `{{< bookmark url="…" … />}}` and calls `state.closeBlock(node)`.

Both parser and serializer are registered when `ProseEditor.tsx`
constructs `MarkdownParser` / `MarkdownSerializer`.

### 3. + menu UI extension

`src/cli/dashboard/web/lib/prose-insert-menu.ts`:

- A new entry `bookmark` added to `MENU_ITEMS`. Always enabled when `proseSchema.nodes.bookmark` exists.
- A new `MenuItemSpec` variant `inputView` joining the existing `run` / `submenu` shapes:

```ts
inputView?: (options: InsertMenuOptions) => {
  placeholder: string;
  validate(value: string): { ok: true; value: string } | { ok: false; error: string };
  run(view, schema, target, value): Promise<{ ok: boolean; error?: string }>;
};
```

- On click, the popover content swaps from the items list to a single `<input type="url">` + submit button. Esc returns to the items list (and refocuses the trigger). Click-outside closes everything.
- During submit, the input goes `disabled`, the button shows a spinner-equivalent (text "…"). On `{ok: true}`, popover closes; on `{ok: false}` the input view stays with `<div role="alert">` rendered below.
- The bookmark item's `inputView.run` calls `POST /api/ogp`, then `replaceEmptyParagraph(view, target, schema.nodes.bookmark.create(meta))`. On fetch failure it inserts `bookmark.create({ url })` and returns `{ ok:false, error }`.

`src/cli/dashboard/web/lib/prose-insert-menu-logic.ts` gains a pure helper
`validateBookmarkUrl(raw): { ok, value } | { ok: false, error }` that:

- trims input,
- rejects empty,
- requires `http:` or `https:` after parse with `new URL()`,
- returns the canonicalised `URL.toString()`.

### 4. OGP fetch endpoint

`src/cli/dashboard/ogp.ts` (new, pure pieces):

```ts
export function classifyHost(hostname: string): 'public' | 'blocked';
export function classifyResolvedIp(ip: string): 'public' | 'blocked';
export function pickMetadata(html: string, finalUrl: URL): OgpMeta;
```

`classifyHost` rejects `localhost`, suffixes `.localhost`, `.local`,
`.internal`, and any literal IP that is loopback / private / link-local /
unspecified / metadata (169.254.169.254, fd00::/8, etc.). `classifyResolvedIp`
does the same on the IP returned by DNS resolution.

`pickMetadata` runs `htmlparser2` against the response body and selects:

| field | precedence |
|-------|------------|
| title | `meta[property="og:title"]` → `meta[name="twitter:title"]` → `<title>` |
| description | `meta[property="og:description"]` → `meta[name="twitter:description"]` → `meta[name="description"]` |
| thumbnail | `meta[property="og:image:secure_url"]` → `meta[property="og:image"]` → `meta[name="twitter:image"]` |
| icon | largest `link[rel*="icon"]` by `sizes` attr, else `/favicon.ico` resolved against origin |
| publisher | `meta[property="og:site_name"]` → URL hostname |
| author | `meta[name="author"]` → `meta[property="article:author"]` |

All values are trimmed and truncated to 300 chars. Relative URLs are
resolved against `finalUrl` (so post-redirect origin wins).

`src/cli/commands/dashboard.ts` adds:

```ts
if (request.method === 'POST' && url.pathname === '/api/ogp') {
  const blocked = validateWriteRequest(request, ctx.security);
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  // … parse + SSRF guard + fetch loop (max 3 redirects) +
  //   read body up to 1MB with AbortController(5s) +
  //   pickMetadata → jsonResponse({ ok:true, meta })
}
```

Failure modes return `200 OK` with `{ ok: false, error }` where `error`
is one of `invalid_url | blocked | timeout | fetch_failed | no_metadata`.
This keeps the client logic uniform and avoids leaking SSRF probes.

### 5. Styles

`src/cli/dashboard/web/styles/*.css` (existing file the dashboard
already loads):

- `.proseBookmarkCard` container — same neutral palette as `.proseInsertItem`.
- Grid: `auto / 1fr` when no thumbnail; `auto / 1fr 96px` when present. Title 1 line clamp, description 2 line clamp.
- `.proseBookmarkActions` mirrors `.proseImageActions` placement and reveal-on-select behaviour.
- `.proseInsertInputView` covers the in-popover URL input + error message.

## Data flow

```
user paste URL
  → validate (client)
  → POST /api/ogp { url }
       server SSRF guard → fetch → htmlparser2 → meta
  → bookmark node with attrs inserted by replaceEmptyParagraph
  → ProseEditor onChange → serialise to markdown
       prose-bookmark-markdown serializer emits {{< bookmark … />}}
  → POST /api/content/posts/<slug> saves the markdown verbatim
  → nectar build reads markdown
       src/content/markdown.ts BOOKMARK_SHORTCODE_RE expands to kg-bookmark-card HTML
  → theme CSS renders the card
```

## Error handling

| Source | Behaviour |
|---|---|
| Client URL parse fail | input view shows "Enter a valid http(s) URL", no network call |
| Server `invalid_url` | same message |
| Server `blocked` | "Cannot preview this URL" (no detail, anti-probe) |
| Server `timeout` / `fetch_failed` | "Could not fetch — inserted URL only", bookmark node created with `url` only |
| Server `no_metadata` | same as fetch_failed (URL-only bookmark) |
| Network error on POST | same as fetch_failed |

## Testing

| Subject | Tests (bun test) |
|---|---|
| `prose-bookmark-markdown.ts` | round-trip md→node→md across full/partial attrs, escaped quotes, URLs with `&`/`=`/Unicode, attribute order stability |
| `prose-bookmark-schema.ts` | node creation with defaults, `toDOM` shape includes `data-url`, `parseDOM` reads kg-bookmark-card figure with all subfields |
| `ogp.ts` | `classifyHost` for `localhost`, `*.local`, `*.internal`; `classifyResolvedIp` for `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`, `::1`, `fc00::/7`; `pickMetadata` against fixture HTML (full OGP, OGP-only, twitter-only, bare `<title>`, no metadata) |
| `/api/ogp` handler | success path (mocked fetch returns html), redirect loop reaches limit, redirect to private IP gets `blocked`, timeout via Abort, non-text response → `no_metadata` |
| insert-menu logic | `validateBookmarkUrl` accepts/rejects edge inputs; menu item enabled iff schema has bookmark node |
| Existing insert-menu integration | new bookmark item appears, switches popover to input view, fires upload on submit (mocked) |

NodeView DOM tests are out of scope per the precedent set by
`prose-image-view.ts`.

## Open questions for implementation

- Whether `proseSchema` extension should land in a new module or directly in `ProseEditor.tsx`. Recommendation: keep `bookmarkNodeSpec` in its own file, import + spread in `ProseEditor.tsx`.
- Whether `validateWriteRequest` is the right gate for `/api/ogp`. It is consistent with `/api/images`, so yes.
- Whether DNS resolution should use `Bun.dns?.lookup` or fall back to `node:dns/promises.lookup`. Bun supports both; we pick `node:dns/promises` for stability and skip lookup when the hostname is already a literal IP.

## File map (new + modified)

New:
- `src/cli/dashboard/web/lib/prose-bookmark-schema.ts`
- `src/cli/dashboard/web/lib/prose-bookmark-view.ts`
- `src/cli/dashboard/web/lib/prose-bookmark-markdown.ts`
- `src/cli/dashboard/ogp.ts`
- `tests/cli/dashboard/prose-bookmark-markdown.test.ts`
- `tests/cli/dashboard/prose-bookmark-schema.test.ts`
- `tests/cli/dashboard/ogp.test.ts`

Modified:
- `src/cli/dashboard/web/components/ProseEditor.tsx` — register node, parser, serializer, NodeView
- `src/cli/dashboard/web/lib/prose-insert-menu.ts` — add `bookmark` item with `inputView`
- `src/cli/dashboard/web/lib/prose-insert-menu-logic.ts` — add `validateBookmarkUrl`
- `src/cli/dashboard/web/lib/api.ts` — add `fetchOgp(url)`
- `src/cli/commands/dashboard.ts` — register `POST /api/ogp` route
- dashboard CSS — add `.proseBookmarkCard` / `.proseInsertInputView` styles
- `tests/cli/dashboard/prose-insert-menu.test.ts` — extend if it exists, or create
