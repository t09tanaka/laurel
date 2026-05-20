# Nectar CLI reference

<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:cli`. -->

This page lists every `nectar` subcommand, flag, and positional argument.
It is generated from the command specs in `src/cli/specs.ts`; run
`bun run docs:cli` after changing a spec to refresh it.

## Synopsis

```
nectar [global options] <command> [options]
```

## Global options

| Flag | Env var | Description |
| --- | --- | --- |
| `--quiet` | `NECTAR_QUIET` | Suppress info/debug output (keeps warn/error) |
| `-V, --verbose` | `NECTAR_VERBOSE` | Increase verbosity to debug (stack `-VV` for trace) |
| `-h, --help` | — | Show help for the top-level CLI or any subcommand |
| `-v, --version` | — | Print the Nectar version and exit |

## Environment variables

Every flag has an env-var fallback so flags can be set without touching the
command line. Useful for `docker-compose`, CI, devcontainers, and `.env` files.

- **Naming:** `NECTAR_<COMMAND>_<FLAG>`, uppercased, with dashes turned into
  underscores. Example: `--port` on `nectar serve` reads from `NECTAR_SERVE_PORT`,
  and `--base-path` on `nectar build` reads from `NECTAR_BUILD_BASE_PATH`.
  Global flags drop the command segment: `NECTAR_QUIET`, `NECTAR_VERBOSE`.
- **Precedence:** CLI flag → env var → config file → built-in default.
- **Boolean values:** `1`, `true`, `yes`, `on` are true; `0`, `false`, `no`,
  `off`, and the empty string are false (case-insensitive). Anything else is
  rejected as a usage error.
- **String values:** used verbatim. An empty string is treated as unset so
  the next layer (config file or default) wins.
- **Verbosity:** `NECTAR_VERBOSE` takes a non-negative integer (`0` = info,
  `1` = debug, `2+` = trace), matching how `-V` / `-VV` stack on the CLI.

Each command section below lists the env-var name for every flag in its
`Env var` column.

## Commands

| Command | Summary |
| --- | --- |
| [`nectar init`](#nectar-init) | Scaffold a new Nectar project in the current (or given) directory |
| [`nectar build`](#nectar-build) | Build the site into the configured output directory |
| [`nectar new`](#nectar-new) | Scaffold a new post, page, tag, or author |
| [`nectar open`](#nectar-open) | Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match |
| [`nectar dev`](#nectar-dev) | Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser |
| [`nectar serve`](#nectar-serve) | Serve the built site locally |
| [`nectar check`](#nectar-check) | Validate config, theme, and content |
| [`nectar doctor`](#nectar-doctor) | Run health checks on the project (bun, config, theme, content, network) |
| [`nectar clean`](#nectar-clean) | Remove dist/ and .nectar-cache build artifacts |
| [`nectar completions`](#nectar-completions) | Print a shell completion script for the given shell |
| [`nectar config`](#nectar-config) | Inspect the loaded nectar.toml config |
| [`nectar content`](#nectar-content) | Inspect or modify content in the project (posts, pages) |
| [`nectar info`](#nectar-info) | Print Nectar, Bun, and project environment information |
| [`nectar lint`](#nectar-lint) | Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter) |
| [`nectar tags`](#nectar-tags) | Inspect or modify tags in the project |
| [`nectar theme`](#nectar-theme) | Manage themes in the project. `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive |
| [`nectar migrate`](#nectar-migrate) | Convert content from another platform into Nectar Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>` |
| [`nectar deploy`](#nectar-deploy) | Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync |
| [`nectar export`](#nectar-export) | Dump the loaded content as JSON or regenerate the RSS feed without running a full build |
| [`nectar import-ghost`](#nectar-import-ghost) | Convert a Ghost JSON export into Markdown content |
| [`nectar import-wordpress`](#nectar-import-wordpress) | Convert a WordPress WXR XML export into Markdown content |

### `nectar init`

Scaffold a new Nectar project in the current (or given) directory

Usage:

```
nectar init [--yes] [--force] [--dir <path>]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-y, --yes` | boolean | `NECTAR_INIT_YES` | Skip prompts and use defaults (non-interactive) |
| `--force` | boolean | `NECTAR_INIT_FORCE` | Overwrite existing files in the target directory |
| `--dir <path>` | string | `NECTAR_INIT_DIR` | Target directory to scaffold into (defaults to .) |

### `nectar build`

Build the site into the configured output directory

Usage:

```
nectar build [--config <path>] [--output <dir>] [--base-path <path>] [--base-url <url>] [--strict] [--profile] [--no-atomic] [--concurrency <n>] [--dry-run] [--include-drafts] [--force] [--watch]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_BUILD_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `-o, --output <dir>` | string | `NECTAR_BUILD_OUTPUT` | Override build.output_dir from the config (relative path inside the project root) |
| `--base-path <path>` | string | `NECTAR_BUILD_BASE_PATH` | Override build.base_path from the config (e.g. /preview/ for PR previews or /repo/ for GitHub Pages) |
| `--base-url <url>` | string | `NECTAR_BUILD_BASE_URL` | Override site.url from the config with an absolute host (e.g. https://pr-42.example.com) so canonical, OG, RSS, and sitemap URLs target preview deploys (Netlify/Vercel/Cloudflare PR URL). Distinct from --base-path, which prefixes the path on a host |
| `--strict` | boolean | `NECTAR_BUILD_STRICT` | Exit with non-zero status if any warnings are emitted |
| `--profile` | boolean | `NECTAR_BUILD_PROFILE` | Write dist/.nectar/profile.json with per-phase timing + bytes_emitted (and per-route render durations) for diagnosing slow builds |
| `--no-atomic` | boolean | `NECTAR_BUILD_NO_ATOMIC` | Disable atomic staging: write directly into build.output_dir instead of a sibling temp dir. Faster on slow filesystems but a mid-build failure leaves a half-written output and skips .nectarignore preservation; intended as an escape hatch for sandboxed CI runners where the rename-into-place step is restricted |
| `--concurrency <n>` | string | `NECTAR_BUILD_CONCURRENCY` | Cap on how many routes render in parallel (positive integer). Defaults to availableParallelism() (CPU count). Lower it on memory-constrained CI runners; raise it cautiously — the render path is CPU-bound on the single JS thread so values above CPU count rarely help |
| `--dry-run` | boolean | `NECTAR_BUILD_DRY_RUN` | Plan routes, load templates, and render every route into memory without writing anything to disk (no staging dir, no asset copies, no manifest, no sitemap/RSS/etc.). Prints the same summary line as a real build; pair with --verbose to also print a per-route table (URL, template, bytes, output path) |
| `--include-drafts` | boolean | `NECTAR_BUILD_INCLUDE_DRAFTS` | Include posts and pages with `status: draft` in the build. Default is to exclude them so a forgotten WIP cannot accidentally ship. Emits a "Building with drafts" warning so the looser policy is visible in CI logs. NECTAR_DRAFTS=1 is honoured as a shorter env-var alias alongside the standard NECTAR_BUILD_INCLUDE_DRAFTS |
| `--force` | boolean | `NECTAR_BUILD_FORCE` | Ignore the previous build manifest (.nectar-manifest.json in the output dir) and re-render every route from scratch. Default behaviour reuses unchanged route HTML when the per-route hash (config + site + theme + template + route data) matches the last successful build; use --force as an escape hatch when the incremental cache appears stale or corrupted |
| `--watch` | boolean | `NECTAR_BUILD_WATCH` | After the initial build, keep the process alive and rebuild on changes to content/, theme/, and nectar.toml. Uses fs.watch with a 100ms debounce; no HTTP server (pair with `nectar serve` or an external static host). Errors in follow-up builds are logged but do not exit; Ctrl-C / SIGTERM stops the loop |

### `nectar new`

Scaffold a new post, page, tag, or author

Usage:

```
nectar new [--config <path>] [--force] [--slug <slug>] [--draft] [--date <iso>] [--tags <a,b,c>] [--author <slug>] [--open] <kind> <title...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<kind>` | required | post, page, tag, or author |
| `<title...>` | required (variadic) | Title (post/page) or slug (tag/author); variadic so quoting is optional for multi-word titles |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_NEW_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--force` | boolean | `NECTAR_NEW_FORCE` | Overwrite the destination file if it already exists |
| `--slug <slug>` | string | `NECTAR_NEW_SLUG` | Use this slug instead of one derived from the title (post/page only; for tag/author the positional already is the slug) |
| `--draft` | boolean | `NECTAR_NEW_DRAFT` | Set frontmatter status to "draft" so the file is excluded from builds until promoted (post/page only) |
| `--date <iso>` | string | `NECTAR_NEW_DATE` | Override the published date with an ISO-8601 timestamp instead of the current time (post only) |
| `--tags <a,b,c>` | string | `NECTAR_NEW_TAGS` | Comma-separated list of tag slugs to seed in frontmatter (post only) |
| `--author <slug>` | string | `NECTAR_NEW_AUTHOR` | Author slug to seed in frontmatter (post only) |
| `--open` | boolean | `NECTAR_NEW_OPEN` | Open the created file in $EDITOR after writing it (warns and skips when $EDITOR is unset) |

### `nectar open`

Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match

Usage:

```
nectar open [--config <path>] [--kind <posts|pages>] [slug]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[slug]` | optional | Slug of the post or page to open (e.g. `hello-world`) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_OPEN_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--kind <posts\|pages>` | string | `NECTAR_OPEN_KIND` | Restrict the lookup to `posts` or `pages` (default: search both). When a slug exists under both kinds the explicit hint avoids the ambiguity error |

### `nectar dev`

Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser

Usage:

```
nectar dev [--config <path>] [--port <n>] [--host <host>]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_DEV_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--port <n>` | string | `NECTAR_DEV_PORT` | Port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port for CI/smoke tests) |
| `--host <host>` | string | `NECTAR_DEV_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |

### `nectar serve`

Serve the built site locally

Usage:

```
nectar serve [--port <n>] [--host <host>] [--no-watch] [--build]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--port <n>` | string | `NECTAR_SERVE_PORT` | Port to listen on (1..65535 integer; defaults to 4321) |
| `--host <host>` | string | `NECTAR_SERVE_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `--no-watch` | boolean | `NECTAR_SERVE_NO_WATCH` | Disable the default rebuild-on-change loop; serve the existing dist/ as a static snapshot |
| `-b, --build` | boolean | `NECTAR_SERVE_BUILD` | Run a full build before starting the server, regardless of whether dist/ already exists |

### `nectar check`

Validate config, theme, and content

Usage:

```
nectar check [--config <path>] [--strict] [--check-links] [--check-external]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_CHECK_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--strict` | boolean | `NECTAR_CHECK_STRICT` | Exit with non-zero status if any warnings were emitted during the check |
| `--check-links` | boolean | `NECTAR_CHECK_CHECK_LINKS` | Scan every post/page body for relative `[text](./foo.md)` cross-links and relative image references; warn if any do not resolve to a known post/page or an existing file. Opt-in because it re-reads every body during check |
| `--check-external` | boolean | `NECTAR_CHECK_CHECK_EXTERNAL` | Probe each external http(s) URL in navigation (and post/page bodies when --check-links is also set) with a HEAD request; warn on non-2xx, timeout, or network failure. Opt-in because it hits the network and is slow; per-URL timeout defaults to 5s |

### `nectar doctor`

Run health checks on the project (bun, config, theme, content, network)

Usage:

```
nectar doctor [--config <path>] [--json] [--no-network]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_DOCTOR_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--json` | boolean | `NECTAR_DOCTOR_JSON` | Emit results as JSON (for CI consumption) |
| `--no-network` | boolean | `NECTAR_DOCTOR_NO_NETWORK` | Skip the network reachability check |

### `nectar clean`

Remove dist/ and .nectar-cache build artifacts

Usage:

```
nectar clean [--config <path>] [--yes] [--dry-run] [--keep <path[,path...]>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_CLEAN_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `-y, --yes` | boolean | `NECTAR_CLEAN_YES` | Skip the confirmation prompt and delete immediately (non-interactive use) |
| `--dry-run` | boolean | `NECTAR_CLEAN_DRY_RUN` | Print the paths that would be removed without actually deleting them. Implies non-interactive. |
| `--keep <path[,path...]>` | string | `NECTAR_CLEAN_KEEP` | Path (relative to cwd) to preserve inside the targets. Repeat the flag is not supported; pass a comma-separated list (e.g. "dist/.well-known,dist/uploads") to keep multiple entries |
| `--json` | boolean | `NECTAR_CLEAN_JSON` | Emit the deletion summary as JSON (paths, kept, bytes) for CI consumption |

### `nectar completions`

Print a shell completion script for the given shell

Usage:

```
nectar completions <shell>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<shell>` | required | Target shell: bash, zsh, fish, or powershell |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |

### `nectar config`

Inspect the loaded nectar.toml config

Usage:

```
nectar config [--config <path>] [--json] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `get <dotted.key>` (print the value at a dotted path, e.g. `site.url` or `build.base_path`) or `path` (print the absolute path of the loaded config file, or nothing in plain mode / `null` in --json mode when no config was found) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_CONFIG_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--json` | boolean | `NECTAR_CONFIG_JSON` | Emit the value as JSON. For `get`: pretty-printed JSON of the value at the dotted path. For `path`: a `{ "config_path": "..." }` envelope so CI consumers can branch on `null` for "no config". |

### `nectar content`

Inspect or modify content in the project (posts, pages)

Usage:

```
nectar content [--config <path>] [--kind <posts|pages>] [--draft] [--tag <slug>] [--author <slug>] [--json] [--redirect] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show posts/pages) or `rename <old-slug> <new-slug>` (move a post/page file + rewrite its `slug` frontmatter) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_CONTENT_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--kind <posts\|pages>` | string | `NECTAR_CONTENT_KIND` | For `list`: filter by content kind (posts or pages). For `rename`: which kind to look up the slug under (defaults to posts; pass `pages` to rename a page slug instead) |
| `--draft` | boolean | `NECTAR_CONTENT_DRAFT` | Include draft posts/pages in the listing (default: only published; `list` only) |
| `--tag <slug>` | string | `NECTAR_CONTENT_TAG` | Show only entries that have the given tag slug (`list` only) |
| `--author <slug>` | string | `NECTAR_CONTENT_AUTHOR` | Show only entries that have the given author slug (`list` only) |
| `--json` | boolean | `NECTAR_CONTENT_JSON` | Emit results as JSON for CI consumption (both `list` and `rename`) |
| `--redirect` | boolean | `NECTAR_CONTENT_REDIRECT` | On `rename`: append a `<old-url>  <new-url>  301` entry to `redirects.yaml` at the project root so the old URL keeps working when emitted through the redirects component |

### `nectar info`

Print Nectar, Bun, and project environment information

Usage:

```
nectar info [--config <path>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_INFO_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--json` | boolean | `NECTAR_INFO_JSON` | Emit the report as JSON for CI consumption |

### `nectar lint`

Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter)

Usage:

```
nectar lint [--config <path>] [--json] [--strict] [--max-title-length <n>]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_LINT_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--json` | boolean | `NECTAR_LINT_JSON` | Emit findings as JSON ({ count, findings: [{ rule, severity, file, message }] }) for CI consumption |
| `--strict` | boolean | `NECTAR_LINT_STRICT` | Exit with non-zero status if any warning-level findings were emitted (errors always exit non-zero) |
| `--max-title-length <n>` | string | `NECTAR_LINT_MAX_TITLE_LENGTH` | Override the max title length before a warning is emitted (default: 70 characters; Google SERP cut-off rule of thumb) |

### `nectar tags`

Inspect or modify tags in the project

Usage:

```
nectar tags [--config <path>] [--orphaned] [--unused] [--json] [--dry-run] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show tags) or `rename <old-slug> <new-slug>` (rewrite every post/page frontmatter reference + move `content/tags/<old>.md` to `<new>.md` atomically) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_TAGS_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--orphaned` | boolean | `NECTAR_TAGS_ORPHANED` | Show only tags that are defined under content/tags/ but referenced by zero posts (`list` only) |
| `--unused` | boolean | `NECTAR_TAGS_UNUSED` | Alias for --orphaned (`list` only) |
| `--json` | boolean | `NECTAR_TAGS_JSON` | Emit results as JSON for CI consumption (both `list` and `rename`) |
| `--dry-run` | boolean | `NECTAR_TAGS_DRY_RUN` | On `rename`: scan and report the files that would change without writing anything |

### `nectar theme`

Manage themes in the project. `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive

Usage:

```
nectar theme [--config <path>] [--from <theme-name>] [--output <path>] [--force] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `new <name>` (scaffold themes/<name>/) or `zip` (archive the active theme into a gscan-compatible .zip) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_THEME_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `--from <theme-name>` | string | `NECTAR_THEME_FROM` | `new` only: copy from an existing theme directory under `themes/` instead of writing the minimal default scaffold |
| `-o, --output <path>` | string | `NECTAR_THEME_OUTPUT` | `zip` only: output path for the archive (defaults to `<name>-<version>.zip` in the current directory) |
| `--force` | boolean | `NECTAR_THEME_FORCE` | Overwrite the destination directory (`new`) or archive (`zip`) if it already exists |

### `nectar migrate`

Convert content from another platform into Nectar Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>`

Usage:

```
nectar migrate [--on-conflict <skip|overwrite|rename>] [--dry-run] [--assets <dir>] [--download-images] [--max-image-size <size>] [--source-url <url>] [--max-size <size>] [--keep-code-injection] <source-and-args...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<source-and-args...>` | required (variadic) | `<source> <path>` where source is one of `ghost`, `wordpress`, `hugo`, `jekyll`, `eleventy` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_MIGRATE_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename (ghost/wordpress only) |
| `--dry-run` | boolean | `NECTAR_MIGRATE_DRY_RUN` | Parse the source and print a summary of what would land without writing files (ghost/wordpress only; hugo/jekyll/eleventy print a copy plan) |
| `--assets <dir>` | string | `NECTAR_MIGRATE_ASSETS` | ghost only: path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `--download-images` | boolean | `NECTAR_MIGRATE_DOWNLOAD_IMAGES` | ghost only: download remote image URLs into content/images/ and rewrite references to local paths |
| `--max-image-size <size>` | string | `NECTAR_MIGRATE_MAX_IMAGE_SIZE` | ghost only: per-image size cap when --download-images is set (e.g. 10MB; default 10MB; 0 disables) |
| `--source-url <url>` | string | `NECTAR_MIGRATE_SOURCE_URL` | ghost only: absolute URL of the source Ghost site; rewrites in-body links pointing at this host to site-relative paths |
| `--max-size <size>` | string | `NECTAR_MIGRATE_MAX_SIZE` | ghost only: max JSON export size before refusing to parse (e.g. 256MB; default 256MB; 0 disables) |
| `--keep-code-injection` | boolean | `NECTAR_MIGRATE_KEEP_CODE_INJECTION` | ghost only: preserve codeinjection_head / codeinjection_foot verbatim. Off by default; only enable when you trust the source. |

### `nectar deploy`

Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync

Usage:

```
nectar deploy [--config <path>] [--build] [--dry-run] [--project-name <name>] [--branch <name>] [--site-id <id>] [--prod] [--bucket <name>] [--region <region>] [--endpoint <url>] [--destination <user@host:path>] [--remote <name>] <target>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<target>` | required | Hosting target: `cloudflare`, `netlify`, `vercel`, `github-pages`, `s3`, `r2`, or `rsync` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_DEPLOY_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `-b, --build` | boolean | `NECTAR_DEPLOY_BUILD` | Run `nectar build` before deploying so the publish step always uses fresh artifacts. Without this flag the command refuses to deploy when `dist/` is missing or has no `.nectar-manifest.json` (the build pre-flight); set it for one-shot deploys from CI without a separate build step |
| `--dry-run` | boolean | `NECTAR_DEPLOY_DRY_RUN` | Print the external command(s) the target would run (or the rsync source/destination, or the gh-pages branch push plan) without spawning anything. Used for CI smoke tests and so reviewers can audit the spawn payload before it is executed |
| `--project-name <name>` | string | `NECTAR_DEPLOY_PROJECT_NAME` | cloudflare only: Cloudflare Pages project name forwarded to `wrangler pages deploy --project-name=<name>`. Overrides `[deploy.cloudflare].project_name`. Required for cloudflare when not set in config |
| `--branch <name>` | string | `NECTAR_DEPLOY_BRANCH` | cloudflare: branch label forwarded to `wrangler pages deploy --branch=<name>`. github-pages: branch to push the site to (defaults to `[deploy.github_pages].branch` or `gh-pages`) |
| `--site-id <id>` | string | `NECTAR_DEPLOY_SITE_ID` | netlify only: Netlify site id forwarded to `netlify deploy --site=<id>`. Overrides `[deploy.netlify].site_id` |
| `--prod` | boolean | `NECTAR_DEPLOY_PROD` | netlify, vercel: explicitly pass `--prod`. Default `true` for both via config (`[deploy.<target>].prod`); pair with `--prod=false`-equivalent NECTAR_DEPLOY_PROD=0 env var when the CLI flag is unsuitable |
| `--bucket <name>` | string | `NECTAR_DEPLOY_BUCKET` | s3 / r2: target bucket name. Forwarded to `aws s3 sync dist s3://<bucket>`. Overrides the matching `[deploy.s3].bucket` or `[deploy.r2].bucket` config entry |
| `--region <region>` | string | `NECTAR_DEPLOY_REGION` | s3 only: AWS region forwarded as `--region <region>` to `aws s3 sync`. Overrides `[deploy.s3].region` |
| `--endpoint <url>` | string | `NECTAR_DEPLOY_ENDPOINT` | r2 only: R2 S3-compatible endpoint URL forwarded as `--endpoint-url <url>` to `aws s3 sync`. Overrides `[deploy.r2].endpoint` |
| `--destination <user@host:path>` | string | `NECTAR_DEPLOY_DESTINATION` | rsync only: destination string (e.g. `user@host:/var/www/site/`). Overrides `[deploy.rsync].destination` |
| `--remote <name>` | string | `NECTAR_DEPLOY_REMOTE` | github-pages only: git remote forwarded to `git push <remote> <branch>` (defaults to `[deploy.github_pages].remote` or `origin`) |

### `nectar export`

Dump the loaded content as JSON or regenerate the RSS feed without running a full build

Usage:

```
nectar export [--config <path>] [--output <path>] [--pretty] [--include-drafts] <format>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<format>` | required | Export format: `json` (Nectar content graph), `ghost-json` (Ghost backup-shaped {db: [{data: {posts, pages, tags, users, posts_tags, posts_authors}}]}), or `rss` (RSS 2.0 XML) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--config <path>` | string | `NECTAR_EXPORT_CONFIG` | Path to nectar.toml (defaults to ./nectar.toml) |
| `-o, --output <path>` | string | `NECTAR_EXPORT_OUTPUT` | Path to write the export to. Defaults to stdout. Parent directories are created as needed; existing files are overwritten |
| `--pretty` | boolean | `NECTAR_EXPORT_PRETTY` | Pretty-print JSON output with 2-space indentation (`json` and `ghost-json` only). Default emits compact JSON |
| `--include-drafts` | boolean | `NECTAR_EXPORT_INCLUDE_DRAFTS` | Include posts and pages with `status: draft` in the export. Off by default so an unintended draft cannot leak through `nectar export` |

### `nectar import-ghost`

Convert a Ghost JSON export into Markdown content

Usage:

```
nectar import-ghost [--on-conflict <skip|overwrite|rename>] [--assets <dir>] [--download-images] [--max-image-size <size>] [--source-url <url>] [--dry-run] [--max-size <size>] [--keep-code-injection] <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<file>` | required | Path to a Ghost export: the JSON file, an unzipped folder, or the .zip archive itself |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_IMPORT_GHOST_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--assets <dir>` | string | `NECTAR_IMPORT_GHOST_ASSETS` | Path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `--download-images` | boolean | `NECTAR_IMPORT_GHOST_DOWNLOAD_IMAGES` | Download remote image URLs (Unsplash, Ghost CDN, …) into content/images/ and rewrite references to local paths |
| `--max-image-size <size>` | string | `NECTAR_IMPORT_GHOST_MAX_IMAGE_SIZE` | Per-image size cap (e.g. 10MB, 1GB, or raw bytes) when --download-images is set; over-cap images are warned and left as remote URLs. Defaults to 10MB. Use 0 to disable. |
| `--source-url <url>` | string | `NECTAR_IMPORT_GHOST_SOURCE_URL` | Absolute URL of the source Ghost site (e.g. https://oldblog.com); rewrites in-body links that point at this host to site-relative paths |
| `--dry-run` | boolean | `NECTAR_IMPORT_GHOST_DRY_RUN` | Parse the export and print a summary of what would land (posts, drafts, empty bodies, conflicts, assets) without writing files or downloading images |
| `--max-size <size>` | string | `NECTAR_IMPORT_GHOST_MAX_SIZE` | Maximum JSON export size accepted before refusing to parse (e.g. 256MB, 1GB, or raw bytes). Defaults to 256MB; guards against multi-GB exports OOM-ing the host. Use 0 to disable the check. |
| `--keep-code-injection` | boolean | `NECTAR_IMPORT_GHOST_KEEP_CODE_INJECTION` | Preserve codeinjection_head / codeinjection_foot from the Ghost export verbatim. Off by default because exports from sites you no longer control can smuggle attacker scripts into {{ghost_head}} / {{ghost_foot}}; only enable when you trust the source. |

### `nectar import-wordpress`

Convert a WordPress WXR XML export into Markdown content

Usage:

```
nectar import-wordpress [--on-conflict <skip|overwrite|rename>] [--dry-run] <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<file>` | required | Path to a WordPress WXR XML export (Tools → Export in wp-admin produces this) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_IMPORT_WORDPRESS_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `NECTAR_IMPORT_WORDPRESS_DRY_RUN` | Parse the export and print a summary of what would land (posts, drafts, type/status-filtered items, empty bodies, conflicts) without writing files |
