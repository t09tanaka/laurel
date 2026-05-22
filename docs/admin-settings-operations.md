# Admin Settings and Operations

Nectar Admin treats repository files and CLI commands as the source of truth. Settings should expose the current state, safe edit surfaces, review-first local actions, and copyable CLI next steps without turning the browser into a deployment runner.

## Settings Cards

- Hand-crafted cards cover core workflow areas: Site, Content paths, Theme, Build, Site structure, Operations, Deploy, Advanced, and Collaboration.
- Schema-derived values are used for labels, current values, and defaults where practical, but important cards stay curated so the interface does not become a raw config dump.
- Unknown `nectar.toml` keys, comments, and unrelated sections are preserved by limiting dashboard writes to fingerprint-gated, section-scoped updates.
- Advanced and dangerous settings are grouped instead of scattered. `build.allow_code_injection`, plugin auto-detect, deploy, import/export, diagnostics, and cache cleanup should not be presented as casual one-click actions. Ghost import is the exception only after a dry-run review: the dashboard accepts a local export path and requires an explicit import action.

## Operations Mapping

| CLI asset | Admin surface | Policy |
| --- | --- | --- |
| `nectar build` | Build readiness and saved output preview | Read-only state and dry-run examples |
| `nectar check` / `nectar doctor` | Content health | CLI remains the validation authority |
| `nectar redirects` | Redirects manager | Validate/list first; editing must be fingerprint-gated |
| `nectar cache` | Cache manager | Stats are read-only; clean requires explicit confirmation |
| `nectar deploy` | Deploy readiness | CLI-only execution, with `--dry-run` examples |
| `nectar import-ghost` | Import/export | Dashboard dry-run first, then explicit local-path import |
| `nectar import-wordpress` / `nectar export` | Import/export | CLI-only examples until review and destination UX are explicit |
| `nectar diagnostics` | Diagnostics bundle | CLI-only until redaction and destination UX are explicit |
| `nectar open` | External editor handoff | Copyable command/path; no automatic app launch from browser |

## Scope Decisions

- Ghost-like Members, newsletters, and paid tiers are not Admin features. Admin may show static subscribe or Portal provider state so operators understand theme output, but it must not imply Nectar runs a member database or newsletter backend.
- File locks are not used. Fingerprint comparison remains the concurrency boundary, and file-watch events should mark open editors stale before save.
- Full body search is deferred until large repositories are measured. Phase 1 searches title, slug, path, tags, authors, and status.
