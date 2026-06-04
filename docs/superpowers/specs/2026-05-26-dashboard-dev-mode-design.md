# Dashboard dev mode (`laurel dashboard --dev`)

Date: 2026-05-26
Status: Approved, ready for implementation plan

## Problem

The Laurel dashboard frontend (`src/cli/dashboard/web/**`) currently requires
a manual pre-build before `laurel dashboard` can serve it. The workflow is:

1. `bun run build:dashboard-bundle` — bundles `entry.tsx` and runs
   `tailwindcss` against `styles.css`, emitting `dist/dashboard-bundle/dashboard.{js,css}`
2. `laurel dashboard` — `Bun.serve()` reads those files via `Bun.file()` and
   serves them as `/assets/dashboard.{js,css}`. If the bundle is missing,
   the response is `503: "Run \`bun run build:dashboard-bundle\` before starting the dashboard."`

There is no watch loop and no browser reload mechanism for frontend assets.
Iterating on a Preact component means re-running the bundle script, restarting
the dashboard process, and hard-reloading the browser. The user request is to
collapse this into "one command launches the dashboard with hot reload."

## Approach

Add a `--dev` flag to `laurel dashboard` that switches the underlying
`Bun.serve()` call from the existing "serve pre-built bundle" path to Bun's
built-in fullstack dev server (HTML imports + on-demand bundling + HMR + console
forwarding). The flag-less invocation continues to serve the pre-built bundle
unchanged.

Bun's fullstack dev server is the runtime-native equivalent of `next dev` /
`vite` for this use case. It accepts an HTML file as a `routes` entry, scans
`<script>` and `<link>` tags with HTMLRewriter, transpiles and bundles the
referenced `.tsx` / `.css` on demand, injects an HMR client, and reuses the
HMR WebSocket to stream browser `console.*` output to the terminal.

## Non-goals

The following are explicitly out of scope for this change:

- Replacing the production bundle path. `scripts/build-dashboard-bundle.ts`
  and the prod-mode `/assets/dashboard.{js,css}` route remain as-is. They are
  still required for `bun run build:cli`, `bun publish`, compiled binaries,
  and npm-installed users.
- HMR for `laurel serve` (the static-site preview server). Different command,
  different concern.
- HBS theme hot reload. Theme changes already round-trip through the dashboard
  content watcher and the build runner; that is not affected by this work.
- Preact Fast Refresh (state-preserving component swaps). Bun's HMR is a plain
  ESM HMR runtime. If Fast Refresh becomes desirable, add it in a follow-up.
- Production caching changes (fingerprinting, long-term caching, etc.).

## Architecture

### Command surface

`laurel dashboard --dev` enables dev mode. All other flags (`--port`, `--host`,
`--open`, `--config`) work identically in both modes.

- Prod (default): serves `dist/dashboard-bundle/dashboard.{js,css}` via
  `Bun.file()`. Returns 503 when the bundle is absent. No change.
- Dev: launches the fullstack dev server. Bundle directory existence is not
  checked. Startup log includes `dev mode (HMR enabled)`.

### `runDashboard` split

`src/cli/commands/dashboard.ts:runDashboard` chooses between two
`Bun.serve()` invocations based on `parsed.values.dev`. The `fetch` handler
(`handleDashboardRequest`) is shared; it owns every `/api/*`, `/preview/*`,
and theme-CSS route.

**Prod mode (existing):**

```ts
Bun.serve({
  port, hostname: host, idleTimeout: 255,
  fetch: (req) => handleDashboardRequest(req, ctx),
});
```

**Dev mode (new):**

```ts
import shellHtml from '../dashboard/web/dashboard.html';

Bun.serve({
  port, hostname: host, idleTimeout: 255,
  development: { hmr: true, console: true },
  routes: {
    '/': shellHtml,
    '/posts': shellHtml,
    '/pages': shellHtml,
    '/components': shellHtml,
    '/authors': shellHtml,
    '/tags': shellHtml,
    '/settings': shellHtml,
    '/settings/design': shellHtml,
    '/settings/integration': shellHtml,
    '/settings/migration': shellHtml,
    '/migration': shellHtml,
    '/posts/new': shellHtml,
    '/pages/new': shellHtml,
    '/components/new': shellHtml,
    '/authors/new': shellHtml,
    '/tags/new': shellHtml,
    '/posts/:slug/edit': shellHtml,
    '/pages/:slug/edit': shellHtml,
    '/components/:slug/edit': shellHtml,
    '/authors/:slug/edit': shellHtml,
    '/tags/:slug/edit': shellHtml,
  },
  fetch: (req) => handleDashboardRequest(req, ctx),
});
```

SPA routes are enumerated in `routes` so that hard-loading any of them from
the browser hits an HMR-enabled HTML response. The list mirrors the SPA
route patterns currently matched inside `handleDashboardRequest` (see
dashboard.ts:1140-1156).

`routes` takes precedence over `fetch` in Bun's dispatch order, so unmatched
URLs fall through to the existing handler unchanged. Prod-only branches inside
`handleDashboardRequest` (HTML shell, `/assets/dashboard.{js,css}`) remain in
place — they are simply unreachable in dev mode because `routes` always wins.
This keeps the diff localized; no per-mode branching inside
`handleDashboardRequest`.

### HTML entrypoint

New file: `src/cli/dashboard/web/dashboard.html`

```html
<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laurel Dashboard</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="root"></div>
<script type="module" src="./entry.tsx"></script>
</body>
</html>
```

References are relative so Bun's HTMLRewriter can resolve them against the
HTML file location (`src/cli/dashboard/web/`).

The existing `src/cli/dashboard/html.ts:renderDashboardHtml()` keeps producing
the prod-mode shell, which points at absolute `/assets/dashboard.{js,css}`.
Two shells exist deliberately:

- Dev shell (`dashboard.html`) — relative TSX / CSS refs, picked up by Bun's
  bundler at request time
- Prod shell (string returned by `renderDashboardHtml()`) — absolute refs to
  pre-built `/assets/dashboard.js` / `/assets/dashboard.css`

Unifying these is not worth the complexity — the asset URL conventions differ
fundamentally between the two modes.

### Token bootstrap

The dashboard process generates a per-session CSRF-style token in
`createDashboardToken()` and currently embeds it via
`<meta name="laurel-dashboard-token" content="${token}">` in the prod shell.
That works because the prod shell is rendered at request time, so the token
can be string-interpolated.

The dev shell is statically imported by Bun at startup, so request-time
interpolation is not available. Move the token into a runtime endpoint that
both modes call:

- **New endpoint:** `GET /api/dashboard/bootstrap`
  - Same-origin only (covered by the existing origin/token validation paths)
  - Response: `{ token: string, mode: 'dev' | 'prod' }`
- **`entry.tsx`** awaits the bootstrap fetch before calling
  `render(<DashboardApp />, root)`, then exposes the token via a small
  module-scoped accessor (e.g. `lib/auth.ts`) consumed by every write request.
- **Prod shell** drops the `<meta>` tag in the same PR — both modes now share
  one token-acquisition path. The `validateWriteRequest()` server-side check
  is unchanged.

This also keeps `dashboard.html` truly static, which is what Bun's HTML import
expects.

### Tailwind plugin

`bun-plugin-tailwind` is registered for the dev server so the dev bundler picks
up Tailwind v4 directives in `styles.css`.

Changes:

1. `bun add -d bun-plugin-tailwind`
2. `bunfig.toml`:
   ```toml
   [serve.static]
   plugins = ["bun-plugin-tailwind"]
   ```
3. Confirm `src/cli/dashboard/web/styles.css` opens with the Tailwind v4
   `@import "tailwindcss"` + `@source` directives. Adjust if needed.

The prod bundle script (`scripts/build-dashboard-bundle.ts`) continues to run
the standalone `tailwindcss` CLI as before. Migrating prod to the plugin is a
follow-up; this PR keeps the blast radius limited to dev mode.

**Risk:** `bun-plugin-tailwind` × Tailwind v4 × the dashboard's specific
`styles.css` may not work out of the box. If the PoC (see Implementation
Notes) fails, the fallback is to spawn `tailwindcss --watch` as a sidecar
process from `runDashboard` when `--dev` is set, writing to a temp directory
that the HTML's `<link>` is rewritten to point at. This is messier but
behaves identically from the browser's perspective.

### API handlers and content watch

`handleDashboardRequest` is unchanged structurally. In dev mode the following
sub-handlers become unreachable because `routes` wins first:

- HTML shell responses for `/`, `/posts`, `/pages`, etc.
- `/assets/dashboard.js`, `/assets/dashboard.css`

Everything else still runs through `fetch`:

- `/api/state`, `/api/content/*`, `/api/settings/*`, `/api/build`,
  `/api/import/*`, `/api/page-bundles/*`, `/api/trash/*`, `/api/events`,
  `/api/themes/active/css`
- `/preview/content`, `/preview/artifact`, `/preview/*` (theme assets)
- The new `/api/dashboard/bootstrap`

The existing `watchDashboardFiles` content watcher (`changeBus` → `/api/events`
SSE) is orthogonal to Bun's HMR:

- **Bun HMR** — frontend asset changes (`*.tsx`, `styles.css`) → module-level
  hot patch via WS
- **`/api/events`** — content / config / theme changes
  (`content/posts/*.md`, `laurel.toml`, theme files) → notifies the SPA to
  re-fetch `/api/state`

These cannot collide. Bun's HMR client uses its own internal WS path
(`/_bun/*`); `handleDashboardRequest` never speaks WebSocket.

## CLAUDE.md update

Add a new section after "Workflow rules" in the project `CLAUDE.md`:

```markdown
## Dashboard frontend development

- Use `bun run src/cli/index.ts dashboard --dev` for iterative work on
  `src/cli/dashboard/web/**`. This launches Bun's fullstack dev server
  with HMR; no pre-build of `dist/dashboard-bundle/` is required.
- `bun run src/cli/index.ts dashboard` (no flag) continues to serve the
  pre-built bundle from `dist/dashboard-bundle/` and is the path used by
  the npm-published CLI and compiled binaries.
- The dev server bundles `.tsx` and Tailwind CSS on demand via
  `bun-plugin-tailwind` (see `bunfig.toml`). The prod bundle is still
  produced by `scripts/build-dashboard-bundle.ts` and is required before
  `bun run build:cli` or `bun publish`.
```

Existing rules (`/codex:review`, `/ask-codex` for frontend text) remain in
force for any code changed through dev mode and are not restated here.

## Tests

Three thin layers, no end-to-end HMR verification (Bun runtime responsibility):

1. **`tests/cli/dashboard/dashboard-dev-mode.test.ts`** — dev-mode smoke test:
   - Start `runDashboard` with `dev: true` on an ephemeral port
   - `GET /` returns 200 with HTML containing `<div id="root">`
   - `GET /api/dashboard/bootstrap` returns `{ token: <non-empty>, mode: 'dev' }`
   - `GET /api/state` still returns the dashboard state JSON (proves `routes`
     + `fetch` coexistence)
   - Server shuts down cleanly on SIGTERM

2. **Existing prod-mode tests under `tests/cli/dashboard/`** — kept passing.
   The prod shell no longer contains the `<meta name="laurel-dashboard-token">`
   tag (token moved to bootstrap), so any test that asserts on the meta tag
   gets updated to assert against `/api/dashboard/bootstrap` instead.

3. **`tests/cli/dashboard/bootstrap-endpoint.test.ts`** — bootstrap unit:
   - Returns `{ token, mode }` for both dev and prod modes
   - Token is non-empty and unique per process

Manual verification before merge: launch `laurel dashboard --dev` against
`example/`, edit a `.tsx` file, confirm browser updates without full reload.

## Implementation notes

Recommend a 30-minute PoC before committing to full implementation, focused on
the three highest-risk items:

1. `bun-plugin-tailwind` × Tailwind v4 × existing `styles.css` — does `@apply`
   and the rest of the project's Tailwind usage resolve cleanly?
2. `routes` + `fetch` coexistence with ~20 SPA routes and the existing API
   handlers — any dispatch surprises?
3. `Bun.serve({ development: { hmr: true } })` triggers HMR for edits to
   `entry.tsx` / `styles.css` without needing `bun --hot` on the process?

If any of those fails, the fallback for #1 is the `tailwindcss --watch`
sidecar (described above). Fallbacks for #2 / #3 require revisiting the
design — escalate to user.

## Files touched (preview)

- `src/cli/commands/dashboard.ts` — `--dev` flag, dev-mode `Bun.serve()`
  branch, new `/api/dashboard/bootstrap` handler
- `src/cli/dashboard/html.ts` — remove `<meta>` token tag from prod shell
- `src/cli/dashboard/web/dashboard.html` — new file (dev shell)
- `src/cli/dashboard/web/entry.tsx` — bootstrap-fetch before render
- `src/cli/dashboard/web/lib/auth.ts` (or wherever the write-header helper
  lives today) — read token from bootstrap accessor instead of meta tag
- `src/cli/specs.ts` (`DASHBOARD_SPEC`) — declare `--dev` flag
- `bunfig.toml` — `[serve.static]` plugins entry
- `package.json` — `bun-plugin-tailwind` devDependency
- `CLAUDE.md` — new "Dashboard frontend development" section
- `tests/cli/dashboard/dashboard-dev-mode.test.ts` — new smoke test
- `tests/cli/dashboard/bootstrap-endpoint.test.ts` — new unit test
- Existing dashboard tests asserting on the token meta tag — updated
