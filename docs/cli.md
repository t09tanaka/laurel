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
| [`nectar serve`](#nectar-serve) | Serve the built site locally |
| [`nectar check`](#nectar-check) | Validate config, theme, and content |
| [`nectar doctor`](#nectar-doctor) | Run health checks on the project (bun, config, theme, content, network) |
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
nectar build [--config <path>] [--output <dir>] [--base-path <path>] [--base-url <url>] [--strict] [--profile] [--no-atomic] [--concurrency <n>] [--dry-run] [--include-drafts]
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

### `nectar serve`

Serve the built site locally

Usage:

```
nectar serve [--port <n>] [--host <host>] [--no-watch]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--port <n>` | string | `NECTAR_SERVE_PORT` | Port to listen on (defaults to 4321) |
| `--host <host>` | string | `NECTAR_SERVE_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `--no-watch` | boolean | `NECTAR_SERVE_NO_WATCH` | Disable the default rebuild-on-change loop; serve the existing dist/ as a static snapshot |

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

### `nectar import-ghost`

Convert a Ghost JSON export into Markdown content

Usage:

```
nectar import-ghost [--on-conflict <skip|overwrite|rename>] [--assets <dir>] [--download-images] [--source-url <url>] [--dry-run] [--max-size <size>] [--keep-code-injection] <file>
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
