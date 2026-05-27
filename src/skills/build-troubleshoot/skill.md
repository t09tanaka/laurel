---
name: nectar-build-troubleshoot
description: Use when a Nectar build, dev server, or dashboard fails to start, errors out mid-build, or produces unexpected output. Walks through the canonical diagnosis commands (`nectar doctor`, `nectar check`, `nectar diagnostics`) and the common error → fix recipes.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - nectar build failed
  - nectar dev error
  - nectar dashboard error
  - theme not found
  - build error
  - frontmatter parse error
  - missing helper
  - why is the build failing
---

# Troubleshooting Nectar builds

Nectar fails fast and tries to embed actionable hints in every error. Before guessing, run the diagnosis commands below and read the error's `hint:` line — most issues are one of the recipes here.

## Diagnosis commands (in priority order)

1. `nectar doctor` — checks Bun version, config, theme presence, content sanity, network. Run this first for any "site won't build" report.
2. `nectar check` — validates config + theme + content together. More thorough than doctor; takes a few seconds longer.
3. `nectar diagnostics --json` — dumps a structured snapshot (config resolution, theme summary, content counts, recent build manifest) for sharing or scripting.
4. `nectar lint content/` — content-only checks (title length, alt text, broken local links, future-date sanity, duplicate slugs).

## Common error → fix recipes

### `Theme directory not found: /path/to/themes/source`

Nectar can't find the theme directory referenced by `[theme].name` + `[theme].dir`. The error's hint shows the exact `git clone` command. Most common fix:

```sh
git clone https://github.com/TryGhost/Source themes/source
```

Other Ghost-compatible themes (Casper, Headline, Edition, Wave, Liebling, …) follow the same pattern — clone into `themes/<name>/` and update `[theme].name` in `nectar.toml`. To use an npm-distributed theme set `[theme].dir` to the package name resolvable via `node_modules/<spec>`.

### `Auto-creating tag "<slug>" referenced by post frontmatter but missing a content/tags/<slug>.md file`

Not fatal — Nectar built a placeholder tag and continued. Silence the warning by creating the file:

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

The theme's `.hbs` calls `{{> "partial"}}` for a partial that doesn't exist under `partials/`. Nectar renders an empty fallback and continues; the warning surfaces theme bugs. Inspect `themes/<name>/partials/` and add the missing file, or strip the `{{> ...}}` reference if the partial isn't needed.

### Dev server / dashboard crashes after several HMR cycles

Known upstream Bun bug in `bake.DevServer.SourceMapStore.addWeakRef` (oven-sh/bun#23617). The dashboard's `--dev` mode and any Bun fullstack dev session can segfault after many HMR reloads. Restart the command — Nectar itself is unaffected. Production (`nectar dashboard` without `--dev`) doesn't hit this path.

### `Port <N> is in use; try --port <N+1>`

Nectar refuses to bind to a busy port. Either kill the prior process (`lsof -ti :4321 | xargs kill`) or pass `--port <other>`. `--port 0` lets the kernel pick a free port (useful for parallel CI jobs).

## When to escalate

If `nectar doctor` reports all green, the error doesn't match the recipes above, and the error's `hint:` line doesn't get you unstuck — collect:

1. `nectar diagnostics --json > diag.json`
2. The exact command + stderr.
3. Bun version (`bun --version`) and OS.

…and open an issue at github.com/t09tanaka/nectar/issues with that bundle.
