---
name: laurel-build-troubleshoot
description: Use when a Laurel build, dev server, or dashboard fails to start, errors out mid-build, or produces unexpected output. Walks through the canonical diagnosis commands (`laurel doctor`, `laurel check`, `laurel diagnostics`) and the common error → fix recipes.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - laurel build failed
  - laurel dev error
  - laurel dashboard error
  - theme not found
  - build error
  - frontmatter parse error
  - missing helper
  - why is the build failing
---

# Troubleshooting Laurel builds

Laurel fails fast and tries to embed actionable hints in every error. Before guessing, run the diagnosis commands below and read the error's `hint:` line — most issues are one of the recipes here.

## Diagnosis commands (in priority order)

1. `laurel doctor` — checks Bun version, config, theme presence, content sanity, network. Run this first for any "site won't build" report.
2. `laurel check` — validates config + theme + content together. More thorough than doctor; takes a few seconds longer.
3. `laurel diagnostics --json` — dumps a structured snapshot (config resolution, theme summary, content counts, recent build manifest) for sharing or scripting.
4. `laurel lint` — content-only checks (title length, alt text, broken local links, future-date sanity, duplicate slugs). Checks the whole `content/` tree; takes no path argument.

## Common error → fix recipes

### `Theme directory not found: <project>/themes/<name>`

(The `<name>` in the error is whatever `[theme].name` is set to in `laurel.toml` — `source`, `casper`, etc., not literally `source`.) Laurel can't find the theme directory referenced by `[theme].name` + `[theme].dir`. The error's hint shows the exact `git clone` command. Most common fix:

```sh
git clone https://github.com/TryGhost/Source themes/source
```

Other Ghost-compatible themes (Casper, Headline, Edition, Wave, Liebling, …) follow the same pattern — clone into `themes/<name>/` and update `[theme].name` in `laurel.toml`. To use an npm-distributed theme set `[theme].dir` to the package name resolvable via `node_modules/<spec>`.

### `Auto-creating tag "<slug>" referenced by post frontmatter but missing a content/tags/<slug>.md file`

Not fatal — Laurel built a placeholder tag and continued. Silence the warning by creating the file:

```yaml
# content/tags/<slug>.md
---
slug: <slug>
name: "Display Name"
description: "What this tag groups."
---
```

Same shape for missing `content/authors/<slug>.md`.

### Frontmatter parse errors

The loader points at the file and line. Most common causes:

- A tab character inside the YAML block (YAML forbids tabs for indentation).
- `tags: foo, bar` instead of `tags: [foo, bar]`.
- An unquoted `:` inside a string value: `title: My title: subtitle` → quote the value.
- An unterminated `---` block (no closing `---` before the body starts).

### `Missing required template '<name>.hbs'`

The theme is missing a required Handlebars template (typically `default.hbs`, `index.hbs`, or `post.hbs`). Either the wrong theme was cloned or the theme directory was pruned. Re-clone or fall back to a known-good theme like Source.

### `Theme '<name>' references missing partial '<partial>'`

The theme's `.hbs` calls `{{> "partial"}}` for a partial that doesn't exist under `partials/`. Laurel renders an empty fallback and continues; the warning surfaces theme bugs. Inspect `themes/<name>/partials/` and add the missing file, or strip the `{{> ...}}` reference if the partial isn't needed.

### Dev server / dashboard crashes after several HMR cycles

Known upstream Bun bug in `bake.DevServer.SourceMapStore.addWeakRef` (oven-sh/bun#23617). The dashboard's `--dev` mode and any Bun fullstack dev session can segfault after many HMR reloads. Restart the command — Laurel itself is unaffected. Production (`laurel dashboard` without `--dev`) doesn't hit this path.

### `Port <N> is in use; try --port <N+1>`

Laurel refuses to bind to a busy port. Either kill the prior process (`lsof -ti :4321 | xargs kill`) or pass `--port <other>`. `--port 0` lets the kernel pick a free port (useful for parallel CI jobs).

## When to escalate

If `laurel doctor` reports all green, the error doesn't match the recipes above, and the error's `hint:` line doesn't get you unstuck — collect:

1. `laurel diagnostics --json > diag.json`
2. The exact command + stderr.
3. Bun version (`bun --version`) and OS.

…and open an issue at github.com/t09tanaka/laurel/issues with that bundle.
