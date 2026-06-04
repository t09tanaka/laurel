# Favicon setting from the dashboard

Date: 2026-05-28
Status: Approved (brainstorming) → implementation

## Problem

Favicon support already exists in the build pipeline: `laurel.toml`'s `[site].icon`
is resolved by `src/build/favicons.ts`, copied to the dist root at a stable URL, and
emitted as `<link rel="icon">` via `{{ghost_head}}`. But the only way to set it today
is to hand-edit `laurel.toml`. Operators using the dashboard (e.g. the ストークモバイル
blog, which already sets `icon = "/content/images/2025/04/favicon-60x60.png"`) have to
drop to the file to change their favicon.

Goal: let an operator upload/replace/clear the site favicon from the dashboard, with
the value persisted to `[site].icon`. Reuse existing plumbing; add no new endpoints.

## Scope

In scope:
- A favicon control in the dashboard Settings → Site panel (`SiteIdentityPanel`).
- Upload via the existing `POST /api/images` endpoint, extended to accept `.ico`.
- Persist the uploaded path (or empty string to clear) to `[site].icon` via the
  existing `PATCH /api/settings/site`.

Out of scope (explicitly not doing now):
- Dashboard controls for `og_image` / `cover_image` / `twitter_image`.
- Auto-generating multiple favicon sizes or `site.webmanifest` from one source image.
- Changing the build's favicon precedence (theme-shipped favicons still win over
  `site.icon`; that behavior is unchanged).
- A URL/path text field — input is upload-only per the approved design.

## Approach (chosen)

Reuse the existing image upload + settings-write machinery. `site.icon` is a string,
which the existing TOML writer (`updateTomlSection`) and the
`SITE_SETTINGS_FIELDS`-driven validation/write path already handle. The only genuinely
new behavior is accepting `.ico` uploads and surfacing the field in the UI.

Rejected alternative: a dedicated `POST /api/favicon` endpoint + `FaviconField`
component. Cleaner separation but more code that duplicates the proven upload path.
Editorial-restraint default favors the minimal diff.

## Changes

### Backend — `src/cli/commands/dashboard.ts`
1. `SITE_SETTINGS_FIELDS` (≈124): add `'icon'`. This single change makes
   `PATCH /api/settings/site` accept `icon`, type-check it as a string
   (`findSettingsTypeErrors`), and write it (`writeSiteSettingsFile` →
   `updateTomlSection(raw, 'site', …)`). Clearing sends `icon: ""`, which writes
   `icon = ""`; `resolveSiteIcon` treats empty as "no favicon", so it is safe.
2. `POST /api/images` `ALLOWED` set (≈1900): add `image/x-icon` and
   `image/vnd.microsoft.icon`. Fix the extension derivation so those map to `ico`
   (the current `file.type.split('/')[1]` would yield `x-icon`).
3. Server `DashboardState` interface (≈535) and `loadDashboardState` site object
   (≈1120): add `icon: string`, sourced from `config.site.icon` (round-trips the file
   value, mirroring the codeinjection rationale).
4. `DashboardSettings` interface (≈629) and `readDashboardSettings` site object
   (≈1294): add `icon: string` for the `GET /api/settings/site` response, keeping the
   two server site-shapes consistent.

### Frontend — `src/cli/dashboard/web`
5. `types.ts` `DashboardState.site` (≈142): add `icon: string`.
6. `components/SettingsView.tsx` `SiteIdentityPanel`: add a `FeatureImageField`
   (label "Favicon") bound to an `icon` state seeded from `site.icon`. On change set
   the value and mark the panel dirty; include `icon` in `handleSaveSite`'s `updates`;
   add `site.icon` to the hydration `useEffect` deps. Reuses the existing
   `featureImageField` styles — no new CSS, no new panel (editorial restraint).

### Prod bundle
7. Regenerate the inlined dashboard bundle (`scripts/build-dashboard-bundle.ts` →
   `src/cli/dashboard/bundled-assets.ts` / `dist/dashboard-bundle/`) so the
   npm-published / compiled CLI serves the new UI.

## Edge cases

- **Clear**: empty string round-trips as `icon = ""`; build emits no favicon link.
- **Theme-shipped favicon precedence**: unchanged. The active theme here ships none,
  so `site.icon` takes effect. No UI warning added (minimal). Documented here so a
  future reader knows it is deliberate.
- **`.ico` preview**: `FeatureImageField` previews via `<img>`; `.ico`/`.svg`/`.png`
  render acceptably.
- **Variant generation side effect**: `POST /api/images` enqueues responsive-variant
  generation for every upload, including favicons. Harmless (unused extra files); not
  worth special-casing for the minimal scope.

## Testing (`tests/cli/commands/dashboard.test.ts`)

- `PATCH /api/settings/site` with `{ icon: "/content/images/x.png" }` writes
  `icon = "/content/images/x.png"` into `[site]` of laurel.toml.
- Clearing with `{ icon: "" }` writes `icon = ""`.
- `POST /api/images` accepts an `image/x-icon` file and stores it as `*.ico`.
- `GET /api/settings/site` / bootstrap surfaces the configured `icon`.
- Run `bun run check && bun test` before pushing.
