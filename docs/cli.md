# Nectar CLI reference

<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:cli`. -->

This page lists every `nectar` subcommand, flag, and positional argument.
It is generated from the command specs in `src/cli/specs.ts`; run
`bun run docs:cli` after changing a spec to refresh it.

## Synopsis

```
nectar [global options] <command> [options]
```

## Argument order

Within a subcommand, flags and positional arguments may be interleaved.
`nectar new --slug foo post "Hello"` and `nectar new post --slug foo "Hello"`
parse the same way. `--` still ends option parsing; every following token is
treated as a positional argument, so literal values such as `--config` or
filenames beginning with `--` can be passed after it.

## Global options

| Flag | Env var | Description |
| --- | --- | --- |
| `-q, --quiet` | `NECTAR_QUIET` | Suppress non-error log output |
| `-V, --verbose` | `NECTAR_VERBOSE` | Increase verbosity to debug (stack `-VV` for trace) |
| `-j, --json` | `NECTAR_JSON` | Emit one JSON object per log line (and JSON-shaped output where the command supports it). Also picks up `NECTAR_JSON=1`. |
| `--log-format <json\|pretty>` | `NECTAR_LOG_FORMAT` | Choose logger output format without changing command output. Use `json` for JSON Lines logs in CI, or `pretty` for human-readable logs. |
| `--no-color` | `NECTAR_NO_COLOR` | Disable ANSI color output. Also honours the standard `NO_COLOR=1` env var; `FORCE_COLOR=1` overrides. |
| `--debug` | `NECTAR_DEBUG` | Show full stack traces when a command errors out. Default mode prints a short message + hint + docs link; set `NECTAR_DEBUG=1` for the same effect from env. |
| `-h, --help` | — | Show help for the top-level CLI or any subcommand |
| `-v, --version` | — | Print the Nectar version and exit. Use `nectar version --json` for machine-readable version metadata. |

## JSON Lines logs

Set `NECTAR_LOG_FORMAT=json` (or pass `--log-format=json`) when CI jobs,
process supervisors, or log shippers need machine-readable Nectar logs
without changing command-specific output such as `nectar version` or
`nectar config get`. Each logger call emits one JSON object per line with
`ts`, `level`, and `msg`; structured logger fields are emitted as additional
top-level properties when present.

```sh
NECTAR_LOG_FORMAT=json nectar build > nectar.log.jsonl
NECTAR_LOG_FORMAT=json nectar dev 2> nectar.err.jsonl
```

```json
{"ts":"2026-05-21T00:00:00.000Z","level":"info","msg":"built","routes":12}
```

`NECTAR_LOG_FORMAT=json` is intentionally different from `NECTAR_JSON=1`
or the global `--json` flag: it only changes the logger surface. Use
`--json` when a subcommand also has a machine-readable result payload.
Use `--log-format=pretty` to force human-readable logs when the environment
sets `NECTAR_LOG_FORMAT=json`.

## Built-in version output

`nectar --version` prints the plain package version for scripts that expect
a single semver line. `nectar version --json` and `nectar --json version`
print machine-readable metadata with `name`, `version`, `bun`, `node`, and
`commit`; `commit` is `null` when it cannot be resolved from the environment
or local Git checkout.

## Environment variables

Every flag has an env-var fallback so flags can be set without touching the
command line. Useful for `docker-compose`, CI, devcontainers, and `.env` files.

- **Naming:** `NECTAR_<COMMAND>_<FLAG>`, uppercased, with dashes turned into
  underscores. Example: `--port` on `nectar serve` reads from `NECTAR_SERVE_PORT`,
  and `--base-path` on `nectar build` reads from `NECTAR_BUILD_BASE_PATH`.
  Global flags drop the command segment: `NECTAR_QUIET`, `NECTAR_VERBOSE`,
  `NECTAR_LOG_FORMAT`.
- **Precedence:** CLI flag → env var → project `.nectarrc` → config file →
  built-in default.
- **Boolean values:** `1`, `true`, `yes`, `on` are true; `0`, `false`, `no`,
  `off`, and the empty string are false (case-insensitive). Anything else is
  rejected as a usage error.
- **String values:** used verbatim. An empty string is treated as unset so
  the next lower-priority layer wins.
- **Verbosity:** `NECTAR_VERBOSE` takes a non-negative integer (`0` = info,
  `1` = debug, `2+` = trace), matching how `-V` / `-VV` stack on the CLI.

## Project `.nectarrc` defaults

A project can keep CLI flag defaults in `.nectarrc.json` (or `.nectarrc`) in
the process cwd. The file is JSON with a `global` object for top-level flags
and one object per command name. Only known flags are read; env vars and CLI
flags override these defaults.

```json
{
  "global": { "verbose": 1 },
  "build": { "output": "dist-preview", "progress": false },
  "serve": { "port": 5000 }
}
```

`nectar config path` prints both the resolved config file and whether a
project rc file was detected; `nectar config path --json` exposes
`config_path` and `rc_path`.

Each command section below lists the env-var name for every flag in its
`Env var` column.

## Repeated flags

Scalar string flags use the last value, so `--output dist-a --output dist-b`
is the same as `--output dist-b`. List-style string flags accumulate in
argument order and are exposed as the same comma-separated value shape their
single-flag form already accepts: `--config base.toml --config prod.toml`,
`--tags news --tags tech`, `--tag news --tag tech`, and
`--keep dist/.well-known --keep dist/uploads` all preserve both values.
Boolean flags may be repeated; the last positive or negated spelling wins
where a negated form exists, for example `--watch --no-watch`.

## Config discovery and `--config`

Commands with `--config <path>` accept one or more TOML or JSON files. Without
it, Nectar checks only the current working directory, first `nectar.toml`, then
`nectar.config.toml`, then `nectar.config.json`; the first existing base file
wins. If `NECTAR_ENV` is set, Nectar then appends `nectar.<env>.toml` when that
file exists. Finally, `.nectar.local.toml` is appended when present so local
overrides written by `nectar config set` win. If no config file exists, the
config schema defaults are used.

Passing `--config`, or setting the matching env var such as
`NECTAR_BUILD_CONFIG`, disables discovery and `NECTAR_ENV` file selection.
Repeat `--config` or comma-separate paths to load multiple files; later files
deep-merge over earlier files, with arrays and scalar values replaced.
Relative paths are resolved from the process cwd.

The programmatic build API mirrors the loader behaviour through
`build({ cwd, configPath })`, but it does not parse CLI flags or
`NECTAR_<COMMAND>_CONFIG` env vars for you. Pass `configPath` as one path,
a comma-separated list, or an ordered array if you want explicit-file mode.

## Generated text file line endings

CLI scaffolders write generated text files with LF (`\n`) line endings on
every OS, including Windows. This applies to `nectar init`, `nectar new`,
and the Markdown/YAML frontmatter files they create. If scaffold input
contains CRLF or bare CR characters, Nectar normalizes those characters
before writing so generated files do not mix CRLF and LF endings.

## Standard input

Most Nectar commands do not consume piped stdin: they read files, config,
or command-line arguments explicitly. The exceptions are narrow and opt-in:
`nectar new <kind> --stdin` reads Markdown body content from stdin, and
`nectar import-ghost -` reads a Ghost JSON export from stdin. Interactive
`nectar init` and `nectar clean` may also read prompt answers from stdin
when prompts are enabled.

## Commands

| Command | Summary |
| --- | --- |
| [`nectar init`](#nectar-init) | Scaffold a new Nectar project in the current (or given) directory |
| [`nectar build`](#nectar-build) | Build the site into the configured output directory |
| [`nectar build:email`](#nectar-build-email) | Render a theme email template for one post |
| [`nectar new`](#nectar-new) | Scaffold a new Markdown content file |
| [`nectar open`](#nectar-open) | Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match |
| [`nectar dev`](#nectar-dev) | Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser |
| [`nectar serve`](#nectar-serve) | Serve the built site locally |
| [`nectar check`](#nectar-check) | Validate config, theme, and content |
| [`nectar doctor`](#nectar-doctor) | Run health checks on the project (bun, config, theme, content, network) |
| [`nectar diagnostics`](#nectar-diagnostics) | Create support-safe diagnostics bundles |
| [`nectar clean`](#nectar-clean) | Remove dist/ and .nectar-cache build artifacts |
| [`nectar completions`](#nectar-completions) | Print or install a shell completion script |
| [`nectar config`](#nectar-config) | Inspect or update the loaded Nectar config |
| [`nectar schema`](#nectar-schema) | Print JSON Schema for Nectar config, frontmatter, or theme package.json |
| [`nectar content`](#nectar-content) | Inspect or modify content in the project (posts, pages) |
| [`nectar info`](#nectar-info) | Print Nectar, Bun, and project environment information |
| [`nectar lint`](#nectar-lint) | Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter) |
| [`nectar fmt`](#nectar-fmt) | Format content Markdown frontmatter in place |
| [`nectar tags`](#nectar-tags) | Inspect or modify tags in the project |
| [`nectar authors`](#nectar-authors) | Inspect authors in the project |
| [`nectar theme`](#nectar-theme) | Manage themes in the project. `list` shows available themes; `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive; `lint <path>` checks a theme directory for required templates / helpers / partials; `serve` runs a fast fixture-backed theme dev server |
| [`nectar migrate`](#nectar-migrate) | Convert content from another platform into Nectar Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>` |
| [`nectar deploy`](#nectar-deploy) | Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync |
| [`nectar export`](#nectar-export) | Dump the loaded content as JSON or regenerate the RSS feed without running a full build |
| [`nectar upgrade`](#nectar-upgrade) | Upgrade the installed Nectar CLI when the install method supports it |
| [`nectar telemetry`](#nectar-telemetry) | Manage opt-in anonymous usage telemetry |
| [`nectar import-ghost`](#nectar-import-ghost) | Convert a Ghost JSON export into Markdown content |
| [`nectar import-wordpress`](#nectar-import-wordpress) | Convert a WordPress WXR XML export into Markdown content |
| [`nectar import-hugo`](#nectar-import-hugo) | Convert Hugo Markdown posts into Nectar content |
| [`nectar import-jekyll`](#nectar-import-jekyll) | Convert Jekyll Markdown posts into Nectar content |

### `nectar init`

Scaffold a new Nectar project in the current (or given) directory

Usage:

```
nectar init [--yes] [--force] [--dir <path>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-y, --yes` | boolean | `NECTAR_INIT_YES` | Skip prompts and use defaults (non-interactive) |
| `--force` | boolean | `NECTAR_INIT_FORCE` | Overwrite existing files in the target directory |
| `--dir <path>` | string | `NECTAR_INIT_DIR` | Target directory to scaffold into (defaults to .) |
| `-j, --json` | boolean | `NECTAR_INIT_JSON` | Emit the scaffold summary (created paths) as JSON on stdout instead of the human "Scaffolded" log |

Examples:

```
nectar init                                  # scaffold in the current dir (interactive)
nectar init --yes                            # accept defaults; CI-friendly
nectar init --dir my-blog --yes              # scaffold a new project folder
```

### `nectar build`

Build the site into the configured output directory

Usage:

```
nectar build [--config <path>] [--output <dir>] [--base-path <path>] [--base-url <url>] [--strict] [--profile] [--atomic] [--no-atomic] [--concurrency <n>] [--dry-run] [--include-drafts] [--force] [--clean] [--no-clean] [--cache] [--no-cache] [--progress] [--no-progress] [--copy-content-assets] [--no-copy-content-assets] [--watch] [--emit-content-api] [--no-emit-content-api] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_BUILD_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <dir>` | string | `NECTAR_BUILD_OUTPUT` | Override build.output_dir from the config (relative path inside the project root) |
| `--base-path <path>` | string | `NECTAR_BUILD_BASE_PATH` | Override build.base_path from the config (e.g. /preview/ for PR previews or /repo/ for GitHub Pages) |
| `--base-url <url>` | string | `NECTAR_BUILD_BASE_URL` | Override site.url from the config with an absolute host (e.g. https://pr-42.example.com) so canonical, OG, RSS, and sitemap URLs target preview deploys (Netlify/Vercel/Cloudflare PR URL). Distinct from --base-path, which prefixes the path on a host |
| `--strict` | boolean | `NECTAR_BUILD_STRICT` | Exit with non-zero status if any warnings are emitted |
| `--profile` | boolean | `NECTAR_BUILD_PROFILE` | Write dist/.nectar-build-stats.json with phase timings, per-route render durations, slowest routes, helper hotspots, and peak RSS for diagnosing slow or memory-heavy builds |
| `--atomic` | boolean | `NECTAR_BUILD_ATOMIC` | Use atomic staging: write into a sibling temp dir before renaming into build.output_dir |
| `--no-atomic` | boolean | `NECTAR_BUILD_ATOMIC=0` | Disable atomic staging: write directly into build.output_dir instead of a sibling temp dir. Faster on slow filesystems but a mid-build failure leaves a half-written output and skips .nectarignore preservation; intended as an escape hatch for sandboxed CI runners where the rename-into-place step is restricted |
| `--concurrency <n>` | string | `NECTAR_BUILD_CONCURRENCY` | Cap on how many routes render in parallel (positive integer). Defaults to availableParallelism() (CPU count). Lower it on memory-constrained CI runners; raise it cautiously — the render path is CPU-bound on the single JS thread so values above CPU count rarely help |
| `--dry-run` | boolean | `NECTAR_BUILD_DRY_RUN` | Plan routes, load templates, and render every route into memory without writing anything to disk (no staging dir, no asset copies, no manifest, no sitemap/RSS/etc.). Prints the same summary line as a real build; pair with --verbose to also print a per-route table (URL, template, bytes, output path) |
| `--include-drafts` | boolean | `NECTAR_BUILD_INCLUDE_DRAFTS` | Include posts and pages with `status: draft` in the build. Default is to exclude them so a forgotten WIP cannot accidentally ship. Emits a "Building with drafts" warning so the looser policy is visible in CI logs. NECTAR_DRAFTS=1 is honoured as a shorter env-var alias alongside the standard NECTAR_BUILD_INCLUDE_DRAFTS |
| `--force` | boolean | `NECTAR_BUILD_FORCE` | Ignore the previous build manifest (.nectar-manifest.json in the output dir) and re-render every route from scratch. Default behaviour reuses unchanged route HTML when the per-route hash (config + site + theme + template + route data) matches the last successful build; use --force as an escape hatch when the incremental cache appears stale or corrupted |
| `--clean` | boolean | `NECTAR_BUILD_CLEAN` | Delete stale files from build.output_dir after the current build completes. Enabled by default; pass --no-clean when the deploy target owns cleanup, such as hashed filenames retained across releases |
| `--no-clean` | boolean | `NECTAR_BUILD_CLEAN=0` | Skip stale-file cleanup in build.output_dir, preserving files that were not emitted by the current build |
| `--cache` | boolean | `NECTAR_BUILD_CACHE` | Use the previous build manifest to skip unchanged route HTML. Enabled by default; pass --no-cache to force every route to render without consulting the incremental cache |
| `--no-cache` | boolean | `NECTAR_BUILD_CACHE=0` | Force every route to render without consulting the incremental cache |
| `--progress` | boolean | `NECTAR_BUILD_PROGRESS` | Print human-readable build progress and summary lines to stdout. Interactive terminals show an in-place spinner and route counter such as `Rendering 12/150...`; piped output uses periodic plain progress logs. Enabled by default; pass --no-progress to keep warnings/errors on stderr while suppressing build progress output. This keeps warnings/errors visible when running `nectar build > build.log` |
| `--no-progress` | boolean | `NECTAR_BUILD_PROGRESS=0` | Suppress human-readable build progress and summary lines on stdout while keeping warnings/errors on stderr |
| `--copy-content-assets` | boolean | `NECTAR_BUILD_COPY_CONTENT_ASSETS` | Copy files from content.assets_dir into the output. Enabled by default from config; pass --no-copy-content-assets to skip that copy for this build |
| `--no-copy-content-assets` | boolean | `NECTAR_BUILD_COPY_CONTENT_ASSETS=0` | Skip copying files from content.assets_dir into the output |
| `-w, --watch` | boolean | `NECTAR_BUILD_WATCH` | After the initial build, keep the process alive and rebuild on changes to content/, theme/, and nectar.toml. Uses fs.watch with a 100ms debounce; no HTTP server (pair with `nectar serve` or an external static host). Errors in follow-up builds are logged but do not exit; Ctrl-C / SIGTERM stops the loop |
| `--emit-content-api` | boolean | `NECTAR_BUILD_EMIT_CONTENT_API` | Override `[components.content_api].enabled` for this build: passing the flag forces the Ghost Content API JSON shadows under `dist/content/` and `dist/ghost/api/content/` on regardless of the config. Without the flag and env var the config value (default `true`) is used |
| `--no-emit-content-api` | boolean | `NECTAR_BUILD_EMIT_CONTENT_API=0` | Force Ghost Content API JSON shadows off for this build without editing the config |
| `-j, --json` | boolean | `NECTAR_BUILD_JSON` | Emit the build completion event as one final JSON line ({ event: "build.done", routeCount, assetCount, outputDir, warningCount, renderedCount, skippedCount, dryRun }) on stdout for CI consumption. Human progress is suppressed; warnings/errors still go to stderr so `nectar build --json > build.jsonl` does not hide failures |

Examples:

```
nectar build                                 # one-shot build into dist/
nectar build --strict                        # fail when the build emits any warnings
nectar build --output dist-preview --base-path /preview/
nectar build --dry-run --verbose             # plan routes without writing anything
nectar build --profile                       # write timings and peak RSS to dist/.nectar-build-stats.json
BUN_INSPECT=1 nectar build --profile         # attach Bun inspector for heap snapshots while profiling
nectar build --watch                         # rebuild on content/theme/config changes
nectar build --json                          # emit the summary as JSON for CI
```

### `nectar build:email`

Render a theme email template for one post

Usage:

```
nectar build:email [--config <path>] [--output <dir>] [--post <slug>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_BUILD_EMAIL_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <dir>` | string | `NECTAR_BUILD_EMAIL_OUTPUT` | Override build.output_dir from the config (relative path inside the project root) |
| `--post <slug>` | string | `NECTAR_BUILD_EMAIL_POST` | Post slug to render through email.hbs or email-template.hbs. Email-only posts are supported. |
| `-j, --json` | boolean | `NECTAR_BUILD_EMAIL_JSON` | Emit the rendered email result as JSON ({ event, post, template, outputPath }) |

Examples:

```
nectar build:email --post=weekly-update
nectar build:email --post=weekly-update --output dist-email-preview
```

### `nectar new`

Scaffold a new Markdown content file

Usage:

```
nectar new [--config <path>] [--force] [--slug <slug>] [--draft] [--date <iso>] [--tags <a,b,c>] [--author <slug>] [--open] [--stdin] [--json] <kind> [title...]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<kind>` | required | Content kind to scaffold. Built-ins are post, page, tag, and author; additional kinds come from [content.kinds] and the active theme package config.content_kinds manifest. |
| `[title...]` | optional (variadic) | Title (post/page/custom kinds) or slug (tag/author); variadic so quoting is optional for multi-word titles. Optional for post/page/custom when --stdin provides a frontmatter title or first H1. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_NEW_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--force` | boolean | `NECTAR_NEW_FORCE` | Overwrite the destination file if it already exists |
| `--slug <slug>` | string | `NECTAR_NEW_SLUG` | Use this lowercase ASCII slug instead of one derived from the title (post/page/custom kinds only; must match /^[a-z0-9][a-z0-9-]*$/; for tag/author the positional already is the slug) |
| `--draft` | boolean | `NECTAR_NEW_DRAFT` | Set frontmatter status to "draft" so the file is excluded from builds until promoted (post/page only) |
| `--date <iso>` | string | `NECTAR_NEW_DATE` | Override the published date with an ISO-8601 timestamp instead of the current time (post only) |
| `--tags <a,b,c>` | string | `NECTAR_NEW_TAGS` | Tag slugs to seed in frontmatter (post only); repeat or comma-separate |
| `--author <slug>` | string | `NECTAR_NEW_AUTHOR` | Author slug to seed in frontmatter (post only) |
| `--open` | boolean | `NECTAR_NEW_OPEN` | Open the created file in $VISUAL or $EDITOR after writing it (logs the path when neither is set) |
| `--stdin` | boolean | `NECTAR_NEW_STDIN` | Read Markdown body content from stdin. If the title positional is omitted for post/page/custom kinds, derive it from stdin frontmatter title or the first H1; frontmatter slug is used when --slug is omitted. |
| `-j, --json` | boolean | `NECTAR_NEW_JSON` | Emit the result (created path, slug, kind) as JSON on stdout instead of the human "Created ..." line |

Examples:

```
nectar new post "Hello World"               # content/posts/hello-world.md
nectar new post "日本語タイトル" --slug japanese-title
nectar new post "Draft Idea" --draft        # status: draft so the build skips it
nectar new post "Tagged" --tags news,tech --author jane
cat post.md | nectar new post --stdin       # derive title/body from Markdown stdin
nectar new tag releases                      # content/tags/releases.md
nectar new author jane                       # content/authors/jane.md
nectar new event "Launch Party"              # custom kind from config/theme manifest
```

### `nectar open`

Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match

Usage:

```
nectar open [--config <path>] [--kind <posts|pages>] [--json] [slug]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[slug]` | optional | Slug of the post or page to open (e.g. `hello-world`) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_OPEN_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--kind <posts\|pages>` | string | `NECTAR_OPEN_KIND` | Restrict the lookup to `posts` or `pages` (default: search both). When a slug exists under both kinds the explicit hint avoids the ambiguity error |
| `-j, --json` | boolean | `NECTAR_OPEN_JSON` | Emit the resolved file path (and slug/kind) as JSON on stdout instead of spawning $EDITOR. Useful for piping into other tooling |

Examples:

```
nectar open hello-world                      # opens content/posts/hello-world.md
nectar open about --kind pages
EDITOR=code nectar open hello-world          # respects $EDITOR
```

### `nectar dev`

Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser

Usage:

```
nectar dev [--config <path>] [--port <n>] [--host <host>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_DEV_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-p, --port <n>` | string | `NECTAR_DEV_PORT` | Port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port for CI/smoke tests) |
| `--host <host>` | string | `NECTAR_DEV_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `-j, --json` | boolean | `NECTAR_DEV_JSON` | Switch logger output (status / rebuild events) to one JSON object per line for CI / log forwarders. Accepted globally; flag here just makes it visible in `--help` |

Examples:

```
nectar dev                                   # http://localhost:4321 with live reload
nectar dev --port 8080                       # pick a different port
nectar dev --host 0.0.0.0                    # expose on the LAN (mobile testing)
```

### `nectar serve`

Serve the built site locally

Usage:

```
nectar serve [--port <n>] [--host <host>] [--watch] [--no-watch] [--build] [--open] [--simulate <target>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-p, --port <n>` | string | `NECTAR_SERVE_PORT` | Port to listen on (1..65535 integer; defaults to 4321) |
| `--host <host>` | string | `NECTAR_SERVE_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `-w, --watch` | boolean | `NECTAR_SERVE_WATCH` | Enable the default rebuild-on-change loop while serving dist/ |
| `--no-watch` | boolean | `NECTAR_SERVE_WATCH=0` | Disable the default rebuild-on-change loop; serve dist/ as a static snapshot |
| `-b, --build` | boolean | `NECTAR_SERVE_BUILD` | Run a full build before starting the server, regardless of whether dist/ already exists |
| `--open` | boolean | `NECTAR_SERVE_OPEN` | Open the served URL in the default browser after the server starts |
| `--simulate <target>` | string | `NECTAR_SERVE_SIMULATE` | Simulate deploy-target redirects and headers from emitted artifacts while serving locally. Supported targets: netlify, cloudflare-pages, vercel |
| `-j, --json` | boolean | `NECTAR_SERVE_JSON` | Switch logger output (rebuild events / lifecycle) to one JSON object per line for CI / log forwarders |

Examples:

```
nectar serve                                 # serve dist/ + rebuild on change
nectar serve --no-watch                      # serve dist/ as a static snapshot
nectar serve --open                          # open the local preview in a browser
nectar serve --simulate netlify --no-watch   # apply emitted _headers/_redirects locally
nectar serve --build                         # build first, then serve
nectar serve --port 8080 --host 0.0.0.0
```

### `nectar check`

Validate config, theme, and content

Usage:

```
nectar check [--config <path>] [--strict] [--check-links] [--check-external] [--check-frontmatter] [--check-templates] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_CHECK_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--strict` | boolean | `NECTAR_CHECK_STRICT` | Exit with non-zero status if any warnings were emitted during the check |
| `--check-links` | boolean | `NECTAR_CHECK_CHECK_LINKS` | Scan every post/page body for relative `[text](./foo.md)` cross-links and relative image references; warn if any do not resolve to a known post/page or an existing file. Opt-in because it re-reads every body during check |
| `--check-external` | boolean | `NECTAR_CHECK_CHECK_EXTERNAL` | Probe each external http(s) URL in navigation (and post/page bodies when --check-links is also set) with a HEAD request; warn on non-2xx, timeout, or network failure. Opt-in because it hits the network and is slow; per-URL timeout defaults to 5s |
| `--check-frontmatter` | boolean | `NECTAR_CHECK_CHECK_FRONTMATTER` | Walk content/posts/**/*.md and content/pages/**/*.md and validate each frontmatter block against the schema (required title, date format, status one of published/draft/scheduled, …). Off by default because it re-reads every file; pair with --strict in CI to fail on warnings |
| `--check-templates` | boolean | `NECTAR_CHECK_CHECK_TEMPLATES` | Cross-check the active theme against the route plan: warn when a route would request a template name (post, page, tag, author, index, default) that does not exist in the theme. Stops a typo in a route layout from rendering through the default fallback unnoticed |
| `-j, --json` | boolean | `NECTAR_CHECK_JSON` | Emit the check report as JSON ({ ok, errors: [...], warnings: [...] }) on stdout for CI consumption. Each entry includes file, line, message, and code |

Examples:

```
nectar check                                 # config + theme + content validation
nectar check --strict                        # fail on any warning (use in CI)
nectar check --check-frontmatter --check-templates
nectar check --check-links                   # also resolve relative markdown links
nectar check --json | jq                     # machine-readable findings
```

### `nectar doctor`

Run health checks on the project (bun, config, theme, content, network)

Usage:

```
nectar doctor [--config <path>] [--json] [--network] [--no-network]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_DOCTOR_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `NECTAR_DOCTOR_JSON` | Emit results as JSON (for CI consumption) |
| `--network` | boolean | `NECTAR_DOCTOR_NETWORK` | Run the network reachability check |
| `--no-network` | boolean | `NECTAR_DOCTOR_NETWORK=0` | Skip the network reachability check |

Examples:

```
nectar doctor                                # full project health check
nectar doctor --no-network                   # skip the connectivity probe
nectar doctor --json                         # machine-readable for CI
```

### `nectar diagnostics`

Create support-safe diagnostics bundles

Usage:

```
nectar diagnostics [--config <path>] [--output <file>] [--log-lines <n>] [--dry-run] [--list] [--json] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `bundle` (write a redacted diagnostics .tar.gz) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_DIAGNOSTICS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <file>` | string | `NECTAR_DIAGNOSTICS_OUTPUT` | Path for the .tar.gz bundle. Defaults to nectar-diagnostics-<timestamp>.tar.gz in the current directory |
| `--log-lines <n>` | string | `NECTAR_DIAGNOSTICS_LOG_LINES` | Maximum number of lines to include from each known Nectar log file. Defaults to 200; use 0 to omit log text while still listing log candidates |
| `--dry-run` | boolean | `NECTAR_DIAGNOSTICS_DRY_RUN` | Print the archive path and entry list without writing a bundle. Useful for auditing what support artifacts would be collected |
| `--list` | boolean | `NECTAR_DIAGNOSTICS_LIST` | Alias for --dry-run: list planned bundle entries without writing the archive |
| `-j, --json` | boolean | `NECTAR_DIAGNOSTICS_JSON` | Emit the bundle result as JSON ({ output, entries, bytes, dryRun }) for CI or support scripts |

Examples:

```
nectar diagnostics bundle
nectar diagnostics bundle --output support/nectar-diagnostics.tar.gz
nectar diagnostics bundle --dry-run
nectar diagnostics bundle --log-lines 50 --json
```

### `nectar clean`

Remove dist/ and .nectar-cache build artifacts

Usage:

```
nectar clean [--config <path>] [--yes] [--dry-run] [--keep <path[,path...]>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_CLEAN_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-y, --yes` | boolean | `NECTAR_CLEAN_YES` | Skip the confirmation prompt and delete immediately (non-interactive use) |
| `--dry-run` | boolean | `NECTAR_CLEAN_DRY_RUN` | Print the paths that would be removed without actually deleting them. Implies non-interactive. |
| `--keep <path[,path...]>` | string | `NECTAR_CLEAN_KEEP` | Path (relative to cwd) to preserve inside the targets. Repeat or comma-separate values (e.g. "dist/.well-known,dist/uploads") to keep multiple entries |
| `-j, --json` | boolean | `NECTAR_CLEAN_JSON` | Emit the deletion summary as JSON (paths, kept, bytes) for CI consumption |

Examples:

```
nectar clean                                 # interactive; asks before deleting
nectar clean --yes                           # non-interactive (CI/scripts)
nectar clean --dry-run                       # show what would be removed
nectar clean --keep dist/.well-known --yes   # preserve specific paths
```

### `nectar completions`

Print or install a shell completion script

Usage:

```
nectar completions [--json] [--shell <auto|bash|zsh|fish|pwsh>] [shell-or-action] [install-shell]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[shell-or-action]` | optional | Target shell (bash, zsh, fish, pwsh) or `install` |
| `[install-shell]` | optional | Optional install target shell: auto, bash, zsh, fish, or pwsh |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-j, --json` | boolean | `NECTAR_COMPLETIONS_JSON` | No-op for `completions`; accepted so the global `--json` flag does not error here. The output is always shell-script text |
| `--shell <auto\|bash\|zsh\|fish\|pwsh>` | string | `NECTAR_COMPLETIONS_SHELL` | Shell to install completions for: auto, bash, zsh, fish, or pwsh |

Examples:

```
nectar completion bash >> ~/.bashrc         # singular alias
nectar completions bash >> ~/.bashrc
nectar completions zsh > ~/.zsh/_nectar
nectar completions fish > ~/.config/fish/completions/nectar.fish
nectar completions install                 # install for the detected shell
nectar completions install --shell zsh     # install under a user-writable zsh path
```

### `nectar config`

Inspect or update the loaded Nectar config

Usage:

```
nectar config [--config <path>] [--json] [--format <json|toml>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `print` (dump the fully resolved config after defaults, env overrides, and config layers), `validate` (load config only and exit 0/1), `get <dotted.key>` (print one value), `set <dotted.key> <value>` (write a string/number/bool), or `path` (print the detected config path and project .nectarrc path/status) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_CONFIG_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `NECTAR_CONFIG_JSON` | Emit the value as JSON. For `print`: equivalent to `--format json`. For `validate`: emit `{ ok, errors }`. For `get`: pretty-printed JSON of the value at the dotted path. For `set`: a `{ "config_path": "..." }` envelope. For `path`: a `{ "config_path": "...", "rc_path": "..." }` envelope so CI consumers can branch on `null` for missing files. |
| `--format <json\|toml>` | string | `NECTAR_CONFIG_FORMAT` | For `print`, choose the resolved config output format: `toml` (default) or `json`. |

Examples:

```
nectar config print                          # resolved config as TOML
nectar config print --format json            # resolved config as JSON
nectar config validate                       # config-only validation
nectar config path                           # detected config and .nectarrc paths
nectar config get site.url
nectar config set site.title "My Site"
nectar config set components.rss.enabled false
nectar config get build.base_path --json
```

### `nectar schema`

Print JSON Schema for Nectar config, frontmatter, or theme package.json

Usage:

```
nectar schema <target>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<target>` | required | `config`, `frontmatter`, or `theme` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |

Examples:

```
nectar schema config > nectar.config.schema.json
nectar schema frontmatter > nectar.frontmatter.schema.json
nectar schema theme > nectar.theme.schema.json
```

### `nectar content`

Inspect or modify content in the project (posts, pages)

Usage:

```
nectar content [--config <path>] [--kind <posts|pages>] [--lines <n>] [--frontmatter] [--draft] [--tag <slug>] [--author <slug>] [--json] [--redirect] [--purge] [--date <iso|now>] [--published] [--published-at <iso|now>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show posts/pages), `show <slug>` (print frontmatter + body preview), `rename <old-slug> <new-slug>` (move a post/page file + rewrite its `slug` frontmatter), `delete <slug>` (move content into `.nectar/trash/` with restore metadata), or `touch <slug>` (update date frontmatter) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_CONTENT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--kind <posts\|pages>` | string | `NECTAR_CONTENT_KIND` | For `list`: filter by content kind (posts or pages). For `show`, `delete`, and `touch`: restrict slug lookup to one kind (default searches posts then pages). For `rename`: which kind to look up the slug under (defaults to posts; pass `pages` to rename a page slug instead) |
| `--lines <n>` | string | `NECTAR_CONTENT_LINES` | For `show`: number of body lines to print after the frontmatter (default: 20) |
| `--frontmatter` | boolean | `NECTAR_CONTENT_FRONTMATTER` | For `show`: print only the YAML frontmatter block, without body preview lines |
| `--draft` | boolean | `NECTAR_CONTENT_DRAFT` | Include draft posts/pages in the listing (default: only published; `list` only) |
| `--tag <slug>` | string | `NECTAR_CONTENT_TAG` | Show only entries that have any given tag slug (`list` only); repeat or comma-separate |
| `--author <slug>` | string | `NECTAR_CONTENT_AUTHOR` | Show only entries that have any given author slug (`list` only); repeat or comma-separate |
| `-j, --json` | boolean | `NECTAR_CONTENT_JSON` | Emit results as JSON for CI consumption (`list`, `show`, `rename`, `delete`, and `touch`) |
| `--redirect` | boolean | `NECTAR_CONTENT_REDIRECT` | On `rename`: append a `<old-url>  <new-url>  301` entry to `redirects.yaml` at the project root so the old URL keeps working when emitted through the redirects component |
| `--purge` | boolean | `NECTAR_CONTENT_PURGE` | On `delete`: permanently remove matching entries from `.nectar/trash/` only when they are at least 30 days old. Never removes current content files |
| `--date <iso\|now>` | string | `NECTAR_CONTENT_DATE` | On `touch`: set `updated_at` to this ISO-8601 timestamp instead of the current time; `now` is also accepted |
| `--published` | boolean | `NECTAR_CONTENT_PUBLISHED` | On `touch`: update `published_at` to the same timestamp as `updated_at` |
| `--published-at <iso\|now>` | string | `NECTAR_CONTENT_PUBLISHED_AT` | On `touch`: set `published_at` to this ISO-8601 timestamp (or `now`) while also updating `updated_at` |

Examples:

```
nectar content list                          # posts + pages with status/date
nectar content list --kind pages
nectar content list --tag changelog --json
nectar content show hello-world --lines 12
nectar content show about --kind pages --frontmatter
nectar content rename old-slug new-slug --redirect
nectar content delete old-slug
nectar content delete --purge old-slug
nectar content touch hello-world --date 2026-01-02T03:04:05Z
nectar content touch about --kind pages --published
```

### `nectar info`

Print Nectar, Bun, and project environment information

Usage:

```
nectar info [--config <path>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_INFO_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `NECTAR_INFO_JSON` | Emit the report as JSON for CI consumption |

Examples:

```
nectar info                                  # human-readable summary
nectar info --json                           # machine-readable; same payload
nectar env                                   # alias for `nectar info`
```

### `nectar lint`

Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter)

Usage:

```
nectar lint [--config <path>] [--json] [--strict] [--max-title-length <n>]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_LINT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `NECTAR_LINT_JSON` | Emit findings as JSON ({ count, findings: [{ rule, severity, file, message }] }) for CI consumption |
| `--strict` | boolean | `NECTAR_LINT_STRICT` | Exit with non-zero status if any warning-level findings were emitted (errors always exit non-zero) |
| `--max-title-length <n>` | string | `NECTAR_LINT_MAX_TITLE_LENGTH` | Override the max title length before a warning is emitted (default: 70 characters; Google SERP cut-off rule of thumb) |

Examples:

```
nectar lint                                  # warn-level summary table
nectar lint --strict                         # exit non-zero on any warning
nectar lint --json | jq                      # CI-friendly findings stream
nectar lint --max-title-length 60
```

### `nectar fmt`

Format content Markdown frontmatter in place

Usage:

```
nectar fmt [--config <path>] [--check]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_FMT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--check` | boolean | `NECTAR_FMT_CHECK` | Check whether content Markdown frontmatter is already formatted without writing changes. Exits 1 when any file would change |

Examples:

```
nectar fmt                                   # rewrite content frontmatter in place
nectar fmt --check                           # CI check; exits 1 when formatting is needed
```

### `nectar tags`

Inspect or modify tags in the project

Usage:

```
nectar tags [--config <path>] [--orphaned] [--unused] [--json] [--dry-run] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show tags), `rename <old-slug> <new-slug>`, or `merge <from> [from...] <into>` (rewrite post/page tag references and safely handle tag files) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_TAGS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--orphaned` | boolean | `NECTAR_TAGS_ORPHANED` | Show only tags that are defined under content/tags/ but referenced by zero posts (`list` only) |
| `--unused` | boolean | `NECTAR_TAGS_UNUSED` | Alias for --orphaned (`list` only) |
| `-j, --json` | boolean | `NECTAR_TAGS_JSON` | Emit results as JSON for CI consumption (`list`, `rename`, and `merge`) |
| `--dry-run` | boolean | `NECTAR_TAGS_DRY_RUN` | On `rename`/`merge`: scan and report the files that would change without writing anything |

Examples:

```
nectar tags list                             # all tags + post counts
nectar tags list --orphaned                  # tags defined but unused
nectar tags rename old-tag new-tag
nectar tags rename old new --dry-run         # preview files that would change
nectar tags merge draft old canonical --dry-run
```

### `nectar authors`

Inspect authors in the project

Usage:

```
nectar authors [--config <path>] [--orphaned] [--json] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show authors and post counts) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_AUTHORS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--orphaned` | boolean | `NECTAR_AUTHORS_ORPHANED` | Show only authors that are defined under content/authors/ but referenced by zero posts (`list` only) |
| `-j, --json` | boolean | `NECTAR_AUTHORS_JSON` | Emit results as JSON for CI consumption (`list` only) |

Examples:

```
nectar authors list                          # all authors + post counts
nectar authors list --orphaned               # authors defined but unused by posts
nectar authors list --json                   # machine-readable author inventory
```

### `nectar theme`

Manage themes in the project. `list` shows available themes; `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive; `lint <path>` checks a theme directory for required templates / helpers / partials; `serve` runs a fast fixture-backed theme dev server

Usage:

```
nectar theme [--config <path>] [--from <theme-name>] [--output <path>] [--force] [--json] [--port <n>] [--host <host>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show themes under theme.dir), `new <name>` (scaffold themes/<name>/), `zip` (archive the active theme into a gscan-compatible .zip), `lint <path>` (audit a theme directory), or `serve` (fast theme dev server) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_THEME_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--from <theme-name>` | string | `NECTAR_THEME_FROM` | `new` only: copy from an existing theme directory under `themes/` instead of writing the minimal default scaffold |
| `-o, --output <path>` | string | `NECTAR_THEME_OUTPUT` | `zip` only: output path for the archive (defaults to `<name>-<version>.zip` in the current directory) |
| `--force` | boolean | `NECTAR_THEME_FORCE` | Overwrite the destination directory (`new`) or archive (`zip`) if it already exists |
| `-j, --json` | boolean | `NECTAR_THEME_JSON` | `list` / `lint`: emit JSON instead of the default table |
| `-p, --port <n>` | string | `NECTAR_THEME_PORT` | `serve` only: port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port) |
| `--host <host>` | string | `NECTAR_THEME_HOST` | `serve` only: hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |

Examples:

```
nectar theme list                            # show themes under theme.dir
nectar theme list --json                     # machine-readable theme list
nectar theme new my-theme                    # scaffold themes/my-theme/
nectar theme new my-fork --from source       # fork the active theme
nectar theme zip                             # ship-ready zip in cwd
nectar theme lint themes/my-theme            # audit before shipping
nectar theme serve                           # fast theme dev server using fixture content
nectar theme serve --port 8080               # pick a different port
nectar theme:lint themes/my-theme            # colon-style alias
```

### `nectar migrate`

Convert content from another platform into Nectar Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>`

Usage:

```
nectar migrate [--on-conflict <skip|overwrite|rename>] [--dry-run] [--assets <dir>] [--download-images] [--max-image-size <size>] [--source-url <url>] [--max-size <size>] [--keep-code-injection] [--json] <source-and-args...>
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
| `-j, --json` | boolean | `NECTAR_MIGRATE_JSON` | Emit the migration summary as JSON on stdout for CI consumption |

Examples:

```
nectar migrate ghost export.json
nectar migrate ghost export.zip --on-conflict overwrite
nectar migrate wordpress export.xml
nectar migrate hugo ./old-hugo-site --dry-run
nectar migrate jekyll ./old-jekyll-site
```

### `nectar deploy`

Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync

Usage:

```
nectar deploy [--config <path>] [--build] [--target <target>] [--dry-run] [--preflight] [--project-name <name>] [--branch <name>] [--site-id <id>] [--prod] [--bucket <name>] [--region <region>] [--endpoint <url>] [--destination <user@host:path>] [--remote <name>] [--json] [target]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[target]` | optional | Hosting target: `cloudflare`, `netlify`, `vercel`, `github-pages`, `s3`, `r2`, or `rsync`. May also be passed as `--target <target>` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_DEPLOY_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-b, --build` | boolean | `NECTAR_DEPLOY_BUILD` | Run `nectar build` before deploying so the publish step always uses fresh artifacts. Without this flag the command refuses to deploy when `dist/` is missing or has no `.nectar-manifest.json` (the build pre-flight); set it for one-shot deploys from CI without a separate build step |
| `--target <target>` | string | `NECTAR_DEPLOY_TARGET` | Hosting target as a flag form for CI templates that prefer named options. Equivalent to the positional <target> |
| `--dry-run` | boolean | `NECTAR_DEPLOY_DRY_RUN` | Print the external command(s), files that would be deployed for the selected target, and the changed-path diff from the last build without spawning anything |
| `--preflight` | boolean | `NECTAR_DEPLOY_PREFLIGHT` | s3 only: before syncing, run `aws s3api get-bucket-policy-status` and warn when the bucket policy is public |
| `--project-name <name>` | string | `NECTAR_DEPLOY_PROJECT_NAME` | cloudflare only: Cloudflare Pages project name forwarded to `wrangler pages deploy --project-name=<name>`. Overrides `[deploy.cloudflare].project_name`. Required for cloudflare when not set in config |
| `--branch <name>` | string | `NECTAR_DEPLOY_BRANCH` | cloudflare: branch label forwarded to `wrangler pages deploy --branch=<name>`. github-pages: branch to push the site to (defaults to `[deploy.github_pages].branch` or `gh-pages`) |
| `--site-id <id>` | string | `NECTAR_DEPLOY_SITE_ID` | netlify only: Netlify site id forwarded to `netlify deploy --site=<id>`. Overrides `[deploy.netlify].site_id` |
| `--prod` | boolean | `NECTAR_DEPLOY_PROD` | netlify, vercel: explicitly pass `--prod`. Default `true` for both via config (`[deploy.<target>].prod`); pair with `--prod=false`-equivalent NECTAR_DEPLOY_PROD=0 env var when the CLI flag is unsuitable |
| `--bucket <name>` | string | `NECTAR_DEPLOY_BUCKET` | s3 / r2: target bucket name. Forwarded to `aws s3 sync dist s3://<bucket>`. Overrides the matching `[deploy.s3].bucket` or `[deploy.r2].bucket` config entry |
| `--region <region>` | string | `NECTAR_DEPLOY_REGION` | s3 only: AWS region forwarded as `--region <region>` to `aws s3 sync`. Overrides `[deploy.s3].region` |
| `--endpoint <url>` | string | `NECTAR_DEPLOY_ENDPOINT` | r2 only: R2 S3-compatible endpoint URL forwarded as `--endpoint-url <url>` to `aws s3 sync`. Overrides `[deploy.r2].endpoint` |
| `--destination <user@host:path>` | string | `NECTAR_DEPLOY_DESTINATION` | rsync only: destination string (e.g. `user@host:/var/www/site/`). Overrides `[deploy.rsync].destination` |
| `--remote <name>` | string | `NECTAR_DEPLOY_REMOTE` | github-pages only: git remote forwarded to `git push <remote> <branch>` (defaults to `[deploy.github_pages].remote` or `origin`) |
| `-j, --json` | boolean | `NECTAR_DEPLOY_JSON` | Emit the deploy plan / outcome as JSON on stdout for CI consumption |

Examples:

```
nectar deploy cloudflare --project-name my-blog --build
nectar deploy netlify --site-id abc123
nectar deploy vercel --prod
nectar deploy github-pages --branch gh-pages
nectar deploy rsync --destination user@host:/var/www/site/
nectar deploy s3 --bucket my-bucket --region us-east-1 --dry-run
nectar deploy s3 --bucket my-bucket --region us-east-1 --preflight
```

### `nectar export`

Dump the loaded content as JSON or regenerate the RSS feed without running a full build

Usage:

```
nectar export [--config <path>] [--output <path>] [--pretty] [--include-drafts] [--json] <format>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<format>` | required | Export format: `json` (Nectar content graph), `ghost-json` (Ghost backup-shaped {db: [{data: {posts, pages, tags, users, posts_tags, posts_authors}}]}), or `rss` (RSS 2.0 XML) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `NECTAR_EXPORT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <path>` | string | `NECTAR_EXPORT_OUTPUT` | Path to write the export to. Defaults to stdout. Parent directories are created as needed; existing files are overwritten |
| `--pretty` | boolean | `NECTAR_EXPORT_PRETTY` | Pretty-print JSON output with 2-space indentation (`json` and `ghost-json` only). Default emits compact JSON |
| `--include-drafts` | boolean | `NECTAR_EXPORT_INCLUDE_DRAFTS` | Include posts and pages with `status: draft` in the export. Off by default so an unintended draft cannot leak through `nectar export` |
| `-j, --json` | boolean | `NECTAR_EXPORT_JSON` | No-op here; `export` already emits its own format-specific payload (json/ghost-json/rss). Accepted so the global `--json` flag does not error |

Examples:

```
nectar export json > content.json
nectar export json --pretty -o snapshot.json
nectar export ghost-json -o ghost-backup.json
nectar export rss -o feed.xml
```

### `nectar upgrade`

Upgrade the installed Nectar CLI when the install method supports it

Usage:

```
nectar upgrade [--dry-run] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--dry-run` | boolean | `NECTAR_UPGRADE_DRY_RUN` | Print the detected upgrade command without running it |
| `-j, --json` | boolean | `NECTAR_UPGRADE_JSON` | Emit the upgrade plan or result as JSON |

Examples:

```
nectar upgrade
nectar upgrade --dry-run
NECTAR_NO_UPDATE_CHECK=1 nectar upgrade       # skip self-update checks and actions
```

### `nectar telemetry`

Manage opt-in anonymous usage telemetry

Usage:

```
nectar telemetry [--endpoint <url>] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `enable`, `disable`, or `status` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--endpoint <url>` | string | `NECTAR_TELEMETRY_ENDPOINT` | Set the stored telemetry endpoint when enabling. NECTAR_TELEMETRY_ENDPOINT overrides it per run |

Examples:

```
nectar telemetry status
nectar telemetry enable
nectar telemetry enable --endpoint https://telemetry.example.test/v1/usage
NECTAR_TELEMETRY_ENDPOINT=http://127.0.0.1:8787/usage nectar build
nectar telemetry disable
```

### `nectar import-ghost`

Convert a Ghost JSON export into Markdown content

Usage:

```
nectar import-ghost [--on-conflict <skip|overwrite|rename>] [--assets <dir>] [--output <dir>] [--download-images] [--max-image-size <size>] [--source-url <url>] [--dry-run] [--include-drafts] [--include-pages] [--only-tags <slugs>] [--since <date>] [--max-size <size>] [--keep-code-injection] [--keep-html] [--json] <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<file>` | required | Path to a Ghost export: the JSON file (.json), an unzipped folder, the .zip archive itself, or - to read JSON from stdin. The file extension is optional; format is sniffed by magic bytes (PK\x03\x04 → zip, leading "{" / "[" → json) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_IMPORT_GHOST_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--assets <dir>` | string | `NECTAR_IMPORT_GHOST_ASSETS` | Path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `-o, --output <dir>` | string | `NECTAR_IMPORT_GHOST_OUTPUT` | Write imported Markdown, assets, and redirect review files under this directory instead of the project content/ and migration/ directories |
| `--download-images` | boolean | `NECTAR_IMPORT_GHOST_DOWNLOAD_IMAGES` | Download remote image URLs (Unsplash, Ghost CDN, …) into content/images/ and rewrite references to local paths |
| `--max-image-size <size>` | string | `NECTAR_IMPORT_GHOST_MAX_IMAGE_SIZE` | Per-image size cap (e.g. 10MB, 1GB, or raw bytes) when --download-images is set; over-cap images are warned and left as remote URLs. Defaults to 10MB. Use 0 to disable. |
| `--source-url <url>` | string | `NECTAR_IMPORT_GHOST_SOURCE_URL` | Absolute URL of the source Ghost site (e.g. https://oldblog.com); rewrites in-body links that point at this host to site-relative paths |
| `--dry-run` | boolean | `NECTAR_IMPORT_GHOST_DRY_RUN` | Parse the export and print a summary of what would land (posts, drafts, empty bodies, conflicts, assets) without writing files or downloading images |
| `--include-drafts` | boolean | `NECTAR_IMPORT_GHOST_INCLUDE_DRAFTS` | When --only-tags or --since is set, include draft posts/pages too. Full imports already include drafts by default for backwards compatibility |
| `--include-pages` | boolean | `NECTAR_IMPORT_GHOST_INCLUDE_PAGES` | When --only-tags or --since is set, include pages too. Full imports already include pages by default for backwards compatibility |
| `--only-tags <slugs>` | string | `NECTAR_IMPORT_GHOST_ONLY_TAGS` | Only import posts tagged with one of these comma-separated tag slugs/names (e.g. news,blog). Tags are slug-normalized before matching |
| `--since <date>` | string | `NECTAR_IMPORT_GHOST_SINCE` | Only import posts/pages whose published_at (or created_at fallback) is on or after this date (e.g. 2024-01-01) |
| `--max-size <size>` | string | `NECTAR_IMPORT_GHOST_MAX_SIZE` | Maximum JSON export size accepted before refusing to parse (e.g. 256MB, 1GB, or raw bytes). Defaults to 256MB; guards against multi-GB exports OOM-ing the host. Use 0 to disable the check. |
| `--keep-code-injection` | boolean | `NECTAR_IMPORT_GHOST_KEEP_CODE_INJECTION` | Preserve codeinjection_head / codeinjection_foot from the Ghost export verbatim. Off by default because exports from sites you no longer control can smuggle attacker scripts into {{ghost_head}} / {{ghost_foot}}; only enable when you trust the source. |
| `--keep-html` | boolean | `NECTAR_IMPORT_GHOST_KEEP_HTML` | Preserve each post/page rendered Ghost HTML body next to its imported Markdown as a sibling <slug>.md.html file. |
| `-j, --json` | boolean | `NECTAR_IMPORT_GHOST_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
nectar import-ghost ghost-export.json
nectar import-ghost - < ghost-export.json   # read JSON from stdin
nectar import-ghost ghost-export.zip            # zip archive (auto-detected)
nectar import-ghost ghost-export --dry-run      # extension-less, magic-bytes sniff
nectar import-ghost export.json --output review-import
nectar import-ghost export.json --only-tags news,blog --since 2024-01-01
nectar import-ghost export.json --only-tags news --include-drafts --include-pages
nectar import-ghost export.json --download-images --max-image-size 5MB
nectar import-ghost export.json --on-conflict overwrite
```

### `nectar import-wordpress`

Convert a WordPress WXR XML export into Markdown content

Usage:

```
nectar import-wordpress [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <file>
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
| `-j, --json` | boolean | `NECTAR_IMPORT_WORDPRESS_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
nectar import-wordpress wordpress.xml
nectar import-wordpress wordpress.xml --dry-run
nectar import-wordpress wordpress.xml --on-conflict rename
```

### `nectar import-hugo`

Convert Hugo Markdown posts into Nectar content

Usage:

```
nectar import-hugo [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <dir>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<dir>` | required | Path to a Hugo project root. Nectar scans content/posts/, content/post/, content/blog/, then content/. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_IMPORT_HUGO_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `NECTAR_IMPORT_HUGO_DRY_RUN` | Scan Markdown and print a summary of what would land, including redirects from aliases, without writing files |
| `-j, --json` | boolean | `NECTAR_IMPORT_HUGO_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
nectar import-hugo ../old-hugo-site
nectar import-hugo ../old-hugo-site --dry-run
nectar import-hugo ../old-hugo-site --on-conflict rename
```

### `nectar import-jekyll`

Convert Jekyll Markdown posts into Nectar content

Usage:

```
nectar import-jekyll [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <dir>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<dir>` | required | Path to a Jekyll project root. Nectar scans _posts/. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `NECTAR_IMPORT_JEKYLL_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `NECTAR_IMPORT_JEKYLL_DRY_RUN` | Scan Markdown and print a summary of what would land, including redirects from aliases, without writing files |
| `-j, --json` | boolean | `NECTAR_IMPORT_JEKYLL_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
nectar import-jekyll ../old-jekyll-site
nectar import-jekyll ../old-jekyll-site --dry-run
nectar import-jekyll ../old-jekyll-site --on-conflict rename
```
