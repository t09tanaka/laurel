# Entry zip handoff — collaboration via portable single-entry archives

Date: 2026-05-29
Status: Approved (design), pending implementation plan
Revision: 2 (reconciled with the existing `src/page-bundle/` implementation)

## Problem

Nectar is standalone: the dashboard assumes a single writer on a single
checkout. Content lives in Markdown + Git, so Git/GitHub users already get
review for free via pull requests. But the people who use the dashboard are
**non-technical editors who never open a PR**. PR review never reaches them.

We want a collaboration handoff that needs **no server, no Git knowledge, and no
account system** — consistent with Nectar's static-only / Git-is-truth pillars.

## What already exists (and what changes)

`src/page-bundle/index.ts` already implements single-entry export/import, but:

- It is a **JSON** bundle (`nectar.page.v1`, assets base64-inlined), not a zip.
- It is **pages-only** (`pages_dir`, `resolveContentSlugPath(slug, ['pages'])`).
- It already has the hard parts: asset collection (`collectBundleAssets`),
  conflict policy (`skip | overwrite | rename`), path-traversal rejection
  (`validateWritableBundlePaths`), and symlink guards.

**Decision: replace it.** We delete the JSON page-bundle and build one **zip**
bundle that is **kind-aware (posts + pages)**, reusing page-bundle's proven
asset/conflict/path-safety logic. All page-bundle wiring (dashboard endpoints,
client API, UI) migrates to the new system. This is a breaking change to the
bundle format (existing `.json` bundles can no longer be imported); acceptable
because this is an internal dashboard feature.

The publish gate is **mostly free**: posts/pages already build only when
`status === 'published'` (drafts excluded in the loader). Adding `needs-review`
to the status enum means an exported entry is automatically excluded from the
published output — no new gate machinery needed. The existing `.nectar/approvals`
sidecar gate for pages is left untouched (orthogonal).

## Solution

Make a single entry (post or page) portable as a self-contained **zip archive**,
and use that zip as the unit of collaboration:

1. A writer exports an entry as a zip from its detail page. Exporting means
   "send for review" — it stamps `status: needs-review` into the entry's
   frontmatter (both in the zip and, on the exporter's own copy, in `content/`).
2. The zip is handed off out of band (email, drive, chat — not Nectar's
   concern).
3. A reviewer imports the zip from the list page. The entry lands in the
   reviewer's `content/` as **needs-review**, ready to be reviewed and approved.

Because workflow state lives in **frontmatter**, the same `status` field is
visible to Git users in a PR diff and to dashboard users in the UI — one field
bridges both worlds. We are **not** reimplementing PR review (diffs, branches,
threaded comments); we are giving dashboard-only editors the review surface PRs
never gave them.

### Collaboration model: round-trip handoff

The same entry is exported, edited, and imported back. On import, a slug
collision with an existing entry is the **normal case**, not an error: the
incoming zip **overwrites** the receiver's copy (conflict policy `overwrite`,
after a confirmation dialog in the UI) and the entry becomes needs-review. This
naturally supports "writer fixes it and sends it back to the editor" in both
directions.

There is **no merge and no conflict detection** (unlike Git). If two people edit
the same entry and both export, the last import wins. This is acceptable for a
sneakernet handoff and is called out explicitly so it is a known limitation, not
a surprise.

## Components

### 1. Zip bundle codec (`src/page-bundle/` rewritten, kind-aware, zip)

Replace the JSON `PageBundle` with a zip-packaged `EntryBundle`:

- Zip layout: `entry.md` (frontmatter + body) and `assets/<filename>` for each
  referenced asset. A `nectar-bundle.json` manifest at the zip root records:
  schema `nectar.bundle.v1`, `kind` (`post` | `page`), `slug`, original `path`,
  site title/url, and `generated_at`.
- **Writer**: extend `src/cli/dashboard/zip-writer.ts` with an in-memory
  multi-entry zip builder (the current `createDistZipStream` walks a directory;
  add a function that takes explicit `{ path, bytes }` entries). Reuse its CRC32
  / deflate / header code.
- **Reader (new)**: parse the End Of Central Directory record + central
  directory, inflate entries (`inflateRawSync`). Mirror the writer's format
  support (no Zip64, no encryption).
- Port `collectBundleAssets`, conflict-policy resolution, symlink guards, and
  `validateWritableBundlePaths` from the deleted page-bundle, generalized to
  resolve against `posts_dir` or `pages_dir` based on `kind`.

### 2. Export (entry detail page)

- Button "Export for review" on the post detail / page detail view.
- Server: resolve the entry by `kind`+`slug`, stamp `status: needs-review` into
  its frontmatter on disk (so the exporter's own copy reflects "sent"),
  bundle `entry.md` + resolved assets (feature image, inline figure images,
  gallery images) + manifest into a zip, stream it as a download.
- Asset resolution reuses the ported `collectBundleAssets`.

### 3. Import (entry list page)

- Button "Import zip" on the posts list (and pages list).
- New server endpoint accepts a multipart zip upload (mirror the existing
  `POST /api/page-bundles/import` / Ghost-import multipart pattern).
- Treat the zip as **untrusted input**:
  - **Zip-slip protection**: reject entries whose normalized path escapes the
    extraction root (`..`, absolute paths, drive letters).
  - **Manifest required**: reject zips lacking a valid `nectar-bundle.json`
    (e.g. a full `dist` export).
  - **Frontmatter validation**: the entry must satisfy the post/page schema
    (`src/content/frontmatter-schema.ts`); reject with a clear error otherwise.
  - **Size / entry caps**: reject implausibly large archives or too many
    entries (zip-bomb defense).
- Import flow: validate + stage in memory/temp; determine target slug+kind from
  the manifest; on slug collision the client shows a confirmation dialog, then
  imports with conflict policy `overwrite`; nothing is written until confirm.
  The landed entry keeps `status: needs-review`.

### 4. Frontmatter `status` value + publish gate

- Add `needs-review` (and `approved`) to `frontmatterStatusValues` in
  `src/content/frontmatter-schema.ts` (currently `published | draft |
  scheduled`).
- The build already emits only `status === 'published'`; `needs-review` /
  `approved` / `draft` are therefore excluded from published output. Verify the
  loader's draft-exclusion path also excludes the new non-published values
  (adjust the predicate to "not published" rather than "is draft" if needed).
- Backward compatibility: posts/pages without `status` already default to
  `published` via the schema, so introducing the new values unpublishes nothing.

### 5. Review queue (dashboard)

In the posts/pages list (`ContentTable`):

- Show a `status` column.
- Add a **"Needs review" filter** so a reviewer sees their queue.

No threaded comments in phase 1.

## Phasing

**Phase 1 (this spec):**
- Rewrite `src/page-bundle/` as the kind-aware zip `EntryBundle` codec
  (writer + reader); delete the JSON `nectar.page.v1` path.
- Migrate all dashboard wiring (endpoints, `lib/api.ts`, `ContentTable`
  `ExportOverflow`, import UI) to the new system, covering posts and pages.
- Export stamps `status: needs-review`; import overwrites on collision (with
  confirm dialog) and lands needs-review.
- Add `needs-review` / `approved` to the status enum; confirm publish gate
  excludes them.
- `status` column + "Needs review" filter in the list.

**Phase 2 (deferred, not in this spec):**
- Editor **identity** (`approvedBy` resolved against `git config` /
  `content/authors/`).
- **Concurrency safety** (optimistic lock on save / external-change detection).
- Lightweight review notes.
- Notifications (optional webhook component; there is no server at request time).

## Out of scope

- Real-time co-editing (would require a server / CRDT — breaks static-only).
- Reimplementing PR review: diffs, branch management, merge, threaded
  discussion. Git users keep using PRs.
- Merge / conflict detection on import (last import wins — documented
  limitation).
- Roles / permissions / team management.
- Backward import of old `nectar.page.v1` JSON bundles.

## Edge cases to handle

- Entry references an asset missing on disk at export time → warn and omit, and
  list the omitted assets in the response.
- Imported entry's `author` does not exist in the receiver's `content/authors/`
  → import succeeds but surfaces a warning; the author slug is preserved for
  later reconciliation.
- Asset filename collision on import (same name, different content) → namespace
  imported assets by slug to avoid clobbering unrelated entries' images.
- Zip from a newer Nectar version → manifest carries a version; import warns on
  mismatch but attempts best-effort.
- Cancelling the overwrite dialog must leave the working tree byte-for-byte
  unchanged (stage in memory/temp; write to `content/` only on confirm).
- Bundle `kind` mismatch (e.g. importing a page bundle from the posts list) →
  import respects the manifest `kind` and routes to the correct dir, or rejects
  with a clear message if the UI context forbids cross-kind import.

## Success criteria

1. From an entry's detail page, "Export for review" downloads a zip containing
   `entry.md` (with `status: needs-review`), all referenced images under
   `assets/`, and a `nectar-bundle.json` manifest; the exporter's own copy is
   updated to `needs-review`.
2. From the list, importing that zip writes the entry into `content/`; if the
   slug exists, a confirmation dialog precedes overwrite; the landed entry shows
   as needs-review.
3. A malicious zip (path traversal, oversized, malformed frontmatter, missing
   manifest, non-bundle archive) is rejected with a clear error and writes
   nothing.
4. The build excludes `draft` / `needs-review` / `approved` entries from live
   output; `published` entries publish.
5. The list shows a `status` column and can filter to "Needs review".
6. The old JSON `nectar.page.v1` page-bundle code and its endpoints are gone;
   pages and posts both use the new zip bundle.
