# Dashboard auto-build (prod-from-source) — design

Date: 2026-06-01

## Problem

`laurel dashboard` (prod mode, the default) serves the dashboard frontend from
`src/cli/dashboard/bundled-assets.ts` — a generated module that embeds the
minified JS/CSS as strings and is loaded into memory at import time. Editing
`src/cli/dashboard/web/**` has no effect until that module is regenerated
(`scripts/build-dashboard-bundle.ts`) **and** the server process is restarted.

In practice this means that when a contributor runs the dashboard from a repo
checkout to inspect it, they frequently see a stale (or, if the bundle was never
built, empty → HTTP 503) UI. The current escape hatch is `laurel dashboard --dev`
(Bun fullstack HMR), but that path is documented as unstable under long sessions
(segfaults in `bake.DevServer.SourceMapStore`, intermittently dropped CSS;
oven-sh/bun#23617).

## Goal

When the dashboard is launched **from a repository source checkout**, the default
(prod) command should serve a freshly built bundle without requiring a manual
pre-build or restart. Live editing with hot reload continues to be served by the
existing `--dev` HMR path (unchanged).

Out of scope: the published npm CLI / compiled binary. Those ship without
`web/**` source or a tailwind binary, so auto-build is impossible there — they
keep serving the embedded `DASHBOARD_BUNDLE_ASSETS` exactly as today.

## Decisions (from brainstorming)

- **Scope**: repository-source runs only. Published binary behavior is unchanged.
- **Hot reload**: keep the existing Bun fullstack HMR (`--dev`). This design does
  not add an SSE full-reload mechanism and does not replace HMR.
- **Build trigger**: mtime-diff. Only rebuild when `web/**` is newer than the
  embedded bundle; otherwise reuse the embedded bundle for a fast startup.

## Design

### 1. Source-run detection

A helper `dashboardSourceBuildContext()` resolves, relative to `import.meta.url`:

- the web entrypoint `src/cli/dashboard/web/entry.tsx`,
- the stylesheet `src/cli/dashboard/web/styles.css`,
- the tailwind binary `node_modules/.bin/tailwindcss`,
- the generated `src/cli/dashboard/bundled-assets.ts`.

It returns a populated context only when the entrypoint, stylesheet, and tailwind
binary all exist on disk. On the published/compiled binary these are absent → it
returns `null` and the auto-build path is skipped entirely.

### 2. Auto-build into memory (prod-from-source)

In `runDashboard` (the CLI entry only), when `mode === 'prod'`,
`--no-build` was not passed, and the source-build context resolves:

1. Compute the newest mtime under `src/cli/dashboard/web/**` (recursive) and
   compare it to the mtime of `bundled-assets.ts`. If `web/**` is not newer,
   skip the build and serve the embedded bundle (fast path).
2. Otherwise run the same two steps as `scripts/build-dashboard-bundle.ts`:
   - `Bun.build` of `entry.tsx` → `dashboard.js` (browser/esm/minify).
   - tailwind CLI over `styles.css` → `dashboard.css` (minify).
   Capture both outputs as **in-memory strings**; do not write
   `bundled-assets.ts` or `dist/dashboard-bundle/` (those remain publish-only
   artifacts).
3. Pass the resulting `{ '/assets/dashboard.js', '/assets/dashboard.css' }` map
   into the request context as a runtime override.

`serveDashboardBundleAsset` consults the runtime override first and falls back to
the embedded `DASHBOARD_BUNDLE_ASSETS` when there is no override (published
binary, `--no-build`, or an mtime-skipped startup).

### 3. Wiring & gating

- `startDashboardServer` gains an optional `runtimeBundleAssets` input
  (default: none). The auto-build is performed in `runDashboard` and the result
  is threaded through. `startDashboardServer` itself never triggers a build, so
  tests and `scripts/dashboard-visual-qa.ts` that call it with `mode: 'prod'`
  are unaffected.
- New CLI flag `--no-build` (boolean) on `DASHBOARD_SPEC` to skip auto-build for
  fast restarts.
- `--dev` is unchanged.

### 4. Startup banner

When the auto-build runs, the banner's `Bundle` row reflects it
(e.g. `built from source (web/**)`), and an info line points contributors at
`--dev` for live hot reload. When skipped via mtime, it shows the embedded
bundle as today.

### 5. Failure handling

Auto-build must never crash the server:

- tailwind binary missing, `Bun.build` failure (e.g. a `.tsx` syntax error), or
  any thrown error → log a `warning` notice with the underlying message and fall
  back to the embedded `DASHBOARD_BUNDLE_ASSETS`. The server still starts.

## Edge cases

- **Published binary / compiled**: source files absent → no build attempted →
  embedded bundle served (current behavior, no regression).
- **`mode === 'dev'`**: untouched. HMR already bundles on the fly; the auto-build
  override is not applied.
- **Direct `startDashboardServer({ mode: 'prod' })` (tests, visual-qa)**: no
  `runtimeBundleAssets` passed → no build → embedded bundle, as today.
- **mtime miss for cross-dir imports**: the recursive mtime scan covers
  `web/**` only. A `.tsx` under `web/` that imports a shared module outside
  `web/` could be missed by the staleness check; `--no-build` is unrelated and a
  forced rebuild is not provided. Documented limitation; acceptable because the
  dashboard web entry imports stay within `web/**`.
- **Empty embedded bundle on a fresh checkout** (`bundled-assets.ts` body `''`):
  `web/**` will be newer than that placeholder, so the first prod-from-source
  launch builds and serves a real bundle instead of the 503.

## Testing

- Unit: `dashboardSourceBuildContext()` returns `null` when entrypoint/tailwind
  absent; returns a context when present.
- Unit: mtime comparison picks "rebuild" when a `web/**` file is newer and
  "skip" otherwise.
- Integration: `serveDashboardBundleAsset` prefers a runtime override map and
  falls back to the embedded bundle when none is supplied.
- Integration: `startDashboardServer({ mode: 'prod' })` with no override still
  serves the embedded bundle (guards the visual-qa / test path).
- CLI help snapshot updated for the new `--no-build` flag.

## Files (anticipated)

- `src/cli/commands/dashboard.ts` — source-build context, auto-build, runtime
  override threading, `serveDashboardBundleAsset` fallback, banner copy.
- `src/cli/specs.ts` — `--no-build` flag + example.
- `tests/cli/commands/dashboard*.test.ts` — coverage above.
- `tests/fixtures/cli-help-snapshots/dashboard.txt` — regenerated snapshot.
- `CLAUDE.md` — update the "Dashboard frontend development" section to describe
  the new prod-from-source auto-build (when to rely on it, the mtime fast path,
  `--no-build`, and that `--dev` remains the live hot-reload path). The existing
  "rebuild then RESTART the prod server" caveat stays for explicit-bundle /
  visual-QA workflows but is reframed: a plain `laurel dashboard` from source now
  rebuilds on launch, so the manual step is only needed when serving the
  committed `dist/dashboard-bundle/` (e.g. the published CLI path).
