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

| Flag | Description |
| --- | --- |
| `--quiet` | Suppress info/debug output (keeps warn/error) |
| `-V, --verbose` | Increase verbosity to debug (stack `-VV` for trace) |
| `-h, --help` | Show help for the top-level CLI or any subcommand |
| `-v, --version` | Print the Nectar version and exit |

## Commands

| Command | Summary |
| --- | --- |
| [`nectar init`](#nectar-init) | Scaffold a new Nectar project in the current (or given) directory |
| [`nectar build`](#nectar-build) | Build the site into the configured output directory |
| [`nectar new`](#nectar-new) | Scaffold a new post or page |
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

| Flag | Type | Description |
| --- | --- | --- |
| `-y, --yes` | boolean | Skip prompts and use defaults (non-interactive) |
| `--force` | boolean | Overwrite existing files in the target directory |
| `--dir <path>` | string | Target directory to scaffold into (defaults to .) |

### `nectar build`

Build the site into the configured output directory

Usage:

```
nectar build [--config <path>] [--output <dir>] [--base-path <path>] [--strict] [--profile]
```

Options:

| Flag | Type | Description |
| --- | --- | --- |
| `--config <path>` | string | Path to nectar.toml (defaults to ./nectar.toml) |
| `-o, --output <dir>` | string | Override build.output_dir from the config (relative path inside the project root) |
| `--base-path <path>` | string | Override build.base_path from the config (e.g. /preview/ for PR previews or /repo/ for GitHub Pages) |
| `--strict` | boolean | Exit with non-zero status if any warnings are emitted |
| `--profile` | boolean | Write dist/.nectar/profile.json with per-phase timing + bytes_emitted (and per-route render durations) for diagnosing slow builds |

### `nectar new`

Scaffold a new post or page

Usage:

```
nectar new [--config <path>] [--force] [--slug <slug>] <kind> <title...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<kind>` | required | post or page |
| `<title...>` | required (variadic) | Title of the post or page |

Options:

| Flag | Type | Description |
| --- | --- | --- |
| `--config <path>` | string | Path to nectar.toml (defaults to ./nectar.toml) |
| `--force` | boolean | Overwrite the destination file if it already exists |
| `--slug <slug>` | string | Use this slug instead of one derived from the title |

### `nectar serve`

Serve the built site locally

Usage:

```
nectar serve [--port <n>] [--host <host>] [--no-watch]
```

Options:

| Flag | Type | Description |
| --- | --- | --- |
| `--port <n>` | string | Port to listen on (defaults to 4321) |
| `--host <host>` | string | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `--no-watch` | boolean | Disable the default rebuild-on-change loop; serve the existing dist/ as a static snapshot |

### `nectar check`

Validate config, theme, and content

Usage:

```
nectar check [--config <path>] [--strict]
```

Options:

| Flag | Type | Description |
| --- | --- | --- |
| `--config <path>` | string | Path to nectar.toml (defaults to ./nectar.toml) |
| `--strict` | boolean | Exit with non-zero status if any warnings were emitted during the check |

### `nectar doctor`

Run health checks on the project (bun, config, theme, content, network)

Usage:

```
nectar doctor [--config <path>] [--json] [--no-network]
```

Options:

| Flag | Type | Description |
| --- | --- | --- |
| `--config <path>` | string | Path to nectar.toml (defaults to ./nectar.toml) |
| `--json` | boolean | Emit results as JSON (for CI consumption) |
| `--no-network` | boolean | Skip the network reachability check |

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

| Flag | Type | Description |
| --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--assets <dir>` | string | Path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `--download-images` | boolean | Download remote image URLs (Unsplash, Ghost CDN, …) into content/images/ and rewrite references to local paths |
| `--source-url <url>` | string | Absolute URL of the source Ghost site (e.g. https://oldblog.com); rewrites in-body links that point at this host to site-relative paths |
| `--dry-run` | boolean | Parse the export and print a summary of what would land (posts, drafts, empty bodies, conflicts, assets) without writing files or downloading images |
| `--max-size <size>` | string | Maximum JSON export size accepted before refusing to parse (e.g. 256MB, 1GB, or raw bytes). Defaults to 256MB; guards against multi-GB exports OOM-ing the host. Use 0 to disable the check. |
| `--keep-code-injection` | boolean | Preserve codeinjection_head / codeinjection_foot from the Ghost export verbatim. Off by default because exports from sites you no longer control can smuggle attacker scripts into {{ghost_head}} / {{ghost_foot}}; only enable when you trust the source. |

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

| Flag | Type | Description |
| --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | Parse the export and print a summary of what would land (posts, drafts, type/status-filtered items, empty bodies, conflicts) without writing files |
