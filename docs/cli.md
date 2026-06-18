# Laurel CLI reference

<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:cli`. -->

This page lists every `laurel` subcommand, flag, and positional argument.
It is generated from the command specs in `src/cli/specs.ts`; run
`bun run docs:cli` after changing a spec to refresh it.

## Synopsis

```
laurel [global options] <command> [options]
```

## Argument order

Within a subcommand, flags and positional arguments may be interleaved.
`laurel new --slug foo post "Hello"` and `laurel new post --slug foo "Hello"`
parse the same way. `--` still ends option parsing; every following token is
treated as a positional argument, so literal values such as `--config` or
filenames beginning with `--` can be passed after it.

## Global options

| Flag | Env var | Description |
| --- | --- | --- |
| `-q, --quiet` | `LAUREL_QUIET` | Suppress non-error log output |
| `-V, --verbose` | `LAUREL_VERBOSE` | Increase verbosity to debug (stack `-VV` for trace) |
| `-j, --json` | `LAUREL_JSON` | Emit one JSON object per log line (and JSON-shaped output where the command supports it). Also picks up `LAUREL_JSON=1`. |
| `--log-format <json\|pretty>` | `LAUREL_LOG_FORMAT` | Choose logger output format without changing command output. Use `json` for JSON Lines logs in CI, or `pretty` for human-readable logs. |
| `--locale <tag>` | `LAUREL_LOCALE` | Set the process locale for CLI diagnostics and locale-sensitive output. |
| `--no-color` | `LAUREL_NO_COLOR` | Disable ANSI color output. Also honours the standard `NO_COLOR=1` env var; `FORCE_COLOR=1` overrides. |
| `--debug` | `LAUREL_DEBUG` | Show full stack traces when a command errors out. Default mode prints a short message + hint + docs link; set `LAUREL_DEBUG=1` for the same effect from env. |
| `--warnings-as-errors` | `LAUREL_WARNINGS_AS_ERRORS` | Exit with code 1 if any logger warning is emitted. |
| `-h, --help` | — | Show help for the top-level CLI or any subcommand |
| `-v, --version` | — | Print the Laurel version and exit. Use `laurel version --json` for machine-readable version metadata. |

## JSON Lines logs

Set `LAUREL_LOG_FORMAT=json` (or pass `--log-format=json`) when CI jobs,
process supervisors, or log shippers need machine-readable Laurel logs
without changing command-specific output such as `laurel version` or
`laurel config get`. Each logger call emits one JSON object per line with
`ts`, `level`, and `msg`; structured logger fields are emitted as additional
top-level properties when present.

```sh
LAUREL_LOG_FORMAT=json laurel build > laurel.log.jsonl
LAUREL_LOG_FORMAT=json laurel dev 2> laurel.err.jsonl
```

```json
{"ts":"2026-05-21T00:00:00.000Z","level":"info","msg":"built","routes":12}
```

`LAUREL_LOG_FORMAT=json` is intentionally different from `LAUREL_JSON=1`
or the global `--json` flag: it only changes the logger surface. Use
`--json` when a subcommand also has a machine-readable result payload.
Use `--log-format=pretty` to force human-readable logs when the environment
sets `LAUREL_LOG_FORMAT=json`.

## Built-in version output

`laurel --version` prints the plain package version for scripts that expect
a single semver line. `laurel version --json` and `laurel --json version`
print machine-readable metadata with `name`, `version`, `bun`, `node`, and
`commit`; `commit` is `null` when it cannot be resolved from the environment
or local Git checkout.

## Environment variables

Every flag has an env-var fallback so flags can be set without touching the
command line. Useful for `docker-compose`, CI, devcontainers, and `.env` files.

- **Naming:** `LAUREL_<COMMAND>_<FLAG>`, uppercased, with dashes turned into
  underscores. Example: `--port` on `laurel serve` reads from `LAUREL_SERVE_PORT`,
  and `--base-path` on `laurel build` reads from `LAUREL_BUILD_BASE_PATH`.
  Global flags drop the command segment: `LAUREL_QUIET`, `LAUREL_VERBOSE`,
  `LAUREL_LOG_FORMAT`, `LAUREL_LOCALE`.
- **Precedence:** CLI flag → env var → project `.laurelrc` → user global
  config → built-in default.
- **Boolean values:** `1`, `true`, `yes`, `on` are true; `0`, `false`, `no`,
  `off`, and the empty string are false (case-insensitive). Anything else is
  rejected as a usage error.
- **String values:** used verbatim. An empty string is treated as unset so
  the next lower-priority layer wins.
- **Verbosity:** `LAUREL_VERBOSE` takes a non-negative integer (`0` = info,
  `1` = debug, `2+` = trace), matching how `-V` / `-VV` stack on the CLI.

## Project `.laurelrc` defaults

A project can keep CLI flag defaults in `.laurelrc.json` (or `.laurelrc`) in
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

`laurel config path` prints both the resolved config file and whether a
project rc file was detected; `laurel config path --json` exposes
`config_path` and `rc_path`.

## User-wide defaults

User-wide defaults live in `~/.config/laurel/config.json` (or
`$XDG_CONFIG_HOME/laurel/config.json`) and use the same JSON shape as
project `.laurelrc` files. They are intended for personal defaults such as
`global.no-color`, `global.locale`, or a preferred `serve.port`. Project
`.laurelrc`, env vars, and CLI flags override them.

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
it, Laurel checks only the current working directory, first `laurel.toml`, then
`laurel.config.toml`, then `laurel.config.json`; the first existing base file
wins. If `LAUREL_ENV` is set, Laurel then appends `laurel.<env>.toml` when that
file exists. Finally, `.laurel.local.toml` is appended when present so local
overrides written by `laurel config set` win. If no config file exists, the
config schema defaults are used.

Passing `--config`, or setting the matching env var such as
`LAUREL_BUILD_CONFIG`, disables discovery and `LAUREL_ENV` file selection.
Repeat `--config` or comma-separate paths to load multiple files; later files
deep-merge over earlier files, with arrays and scalar values replaced.
Relative paths are resolved from the process cwd.

The programmatic build API mirrors the loader behaviour through
`build({ cwd, configPath })`, but it does not parse CLI flags or
`LAUREL_<COMMAND>_CONFIG` env vars for you. Pass `configPath` as one path,
a comma-separated list, or an ordered array if you want explicit-file mode.

## Generated text file line endings

CLI scaffolders write generated text files with LF (`\n`) line endings on
every OS, including Windows. This applies to `laurel init`, `laurel new`,
and the Markdown/YAML frontmatter files they create. If scaffold input
contains CRLF or bare CR characters, Laurel normalizes those characters
before writing so generated files do not mix CRLF and LF endings.

## Standard input

Most Laurel commands do not consume piped stdin: they read files, config,
or command-line arguments explicitly. The exceptions are narrow and opt-in:
`laurel new <kind> --stdin` reads Markdown body content from stdin, and
`laurel import-ghost -` reads a Ghost JSON export from stdin. Interactive
`laurel init` and `laurel clean` may also read prompt answers from stdin
when prompts are enabled.

## Commands

| Command | Summary |
| --- | --- |
| [`laurel init`](#laurel-init) | Scaffold a new Laurel project in the current (or given) directory |
| [`laurel build`](#laurel-build) | Build the site into the configured output directory |
| [`laurel build:email`](#laurel-build-email) | Render a theme email template for one post |
| [`laurel new`](#laurel-new) | Scaffold a new Markdown content file |
| [`laurel open`](#laurel-open) | Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match |
| [`laurel test`](#laurel-test) | Run the project test suite via Bun test (passthrough placeholder) |
| [`laurel dev`](#laurel-dev) | Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser |
| [`laurel serve`](#laurel-serve) | Serve the built site as a local preview server; not for production hosting |
| [`laurel dashboard`](#laurel-dashboard) | Run the local file-backed editorial dashboard |
| [`laurel check`](#laurel-check) | Validate config, theme, and content |
| [`laurel doctor`](#laurel-doctor) | Run health checks on the project (bun, config, theme, content, network) |
| [`laurel diagnostics`](#laurel-diagnostics) | Create support-safe diagnostics bundles |
| [`laurel clean`](#laurel-clean) | Remove dist/ and .laurel/cache build artifacts |
| [`laurel cache`](#laurel-cache) | Inspect or remove the local .laurel/cache directory |
| [`laurel completions`](#laurel-completions) | Print or install a shell completion script |
| [`laurel config`](#laurel-config) | Inspect or update the loaded Laurel config |
| [`laurel schema`](#laurel-schema) | Print JSON Schema for Laurel config, frontmatter, or theme package.json |
| [`laurel skill`](#laurel-skill) | Install bundled agent skills (Claude Code / Codex) so AI assistants understand how to work in this Laurel project |
| [`laurel content`](#laurel-content) | Inspect or modify content in the project (posts, pages) |
| [`laurel redirects`](#laurel-redirects) | Inspect redirect rules loaded from redirects.yaml and Ghost exports |
| [`laurel info`](#laurel-info) | Print Laurel, Bun, and project environment information |
| [`laurel lint`](#laurel-lint) | Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter) |
| [`laurel fmt`](#laurel-fmt) | Format content Markdown frontmatter in place |
| [`laurel tags`](#laurel-tags) | Inspect or modify tags in the project |
| [`laurel authors`](#laurel-authors) | Inspect or modify authors in the project |
| [`laurel theme`](#laurel-theme) | Manage themes in the project. `list` shows available themes; `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive; `lint <path>` checks a theme directory for required templates / helpers / partials; `serve` runs a fast fixture-backed theme dev server |
| [`laurel migrate`](#laurel-migrate) | Convert content from another platform into Laurel Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>` |
| [`laurel deploy`](#laurel-deploy) | Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync |
| [`laurel export`](#laurel-export) | Dump the loaded content, a single entry bundle, a components bundle, or regenerate the RSS feed without running a full build |
| [`laurel import`](#laurel-import) | Import a Laurel zip bundle: an entry (post or page) or a components bundle |
| [`laurel upgrade`](#laurel-upgrade) | Upgrade the installed Laurel CLI when the install method supports it |
| [`laurel telemetry`](#laurel-telemetry) | Manage opt-in anonymous usage telemetry |
| [`laurel plugins`](#laurel-plugins) | Inspect future Laurel plugins |
| [`laurel import-ghost`](#laurel-import-ghost) | Convert a Ghost JSON export into Markdown content |
| [`laurel import-wordpress`](#laurel-import-wordpress) | Convert a WordPress WXR XML export into Markdown content |
| [`laurel import-hugo`](#laurel-import-hugo) | Convert Hugo Markdown posts into Laurel content |
| [`laurel import-jekyll`](#laurel-import-jekyll) | Convert Jekyll Markdown posts into Laurel content |

### `laurel init`

Scaffold a new Laurel project in the current (or given) directory

Usage:

```
laurel init [--yes] [--force] [--dir <path>] [--agent <claude|codex|both|none>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-y, --yes` | boolean | `LAUREL_INIT_YES` | Skip prompts and use defaults (non-interactive) |
| `--force` | boolean | `LAUREL_INIT_FORCE` | Overwrite existing files in the target directory |
| `--dir <path>` | string | `LAUREL_INIT_DIR` | Target directory to scaffold into (defaults to .) |
| `--agent <claude\|codex\|both\|none>` | string | `LAUREL_INIT_AGENT` | Wire up AI assistant skills non-interactively: `claude` (CLAUDE.md), `codex` (AGENTS.md), `both`, or `none` (default). Creates the marker file if missing and installs the bundled skills for that format. Overrides the interactive prompt |
| `-j, --json` | boolean | `LAUREL_INIT_JSON` | Emit the scaffold summary (created paths) as JSON on stdout instead of the human "Scaffolded" log |

Examples:

```
laurel init                                  # scaffold in the current dir (interactive)
laurel init --yes                            # accept defaults; CI-friendly
laurel init --dir my-blog --yes              # scaffold a new project folder
laurel init --yes --agent claude             # also create CLAUDE.md + install skills
laurel init --yes --agent both               # wire up Claude Code and Codex
```

### `laurel build`

Build the site into the configured output directory

Usage:

```
laurel build [--config <path>] [--output <dir>] [--base-path <path>] [--base-url <url>] [--strict] [--profile] [--atomic] [--no-atomic] [--concurrency <n>] [--dry-run] [--include-drafts] [--force] [--clean] [--no-clean] [--cache] [--no-cache] [--progress] [--no-progress] [--copy-content-assets] [--no-copy-content-assets] [--watch] [--emit-content-api] [--no-emit-content-api] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_BUILD_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <dir>` | string | `LAUREL_BUILD_OUTPUT` | Override build.output_dir from the config (relative path inside the project root) |
| `--base-path <path>` | string | `LAUREL_BUILD_BASE_PATH` | Override build.base_path from the config (e.g. /preview/ for PR previews or /repo/ for GitHub Pages) |
| `--base-url <url>` | string | `LAUREL_BUILD_BASE_URL` | Override site.url from the config with an absolute host (e.g. https://pr-42.example.com) so canonical, OG, RSS, and sitemap URLs target preview deploys (Netlify/Vercel/Cloudflare PR URL). Distinct from --base-path, which prefixes the path on a host |
| `--strict` | boolean | `LAUREL_BUILD_STRICT` | Exit with non-zero status if any warnings are emitted |
| `--profile` | boolean | `LAUREL_BUILD_PROFILE` | Write dist/.laurel-build-stats.json with phase timings, per-route render durations, slowest routes, helper hotspots, and peak RSS for diagnosing slow or memory-heavy builds |
| `--atomic` | boolean | `LAUREL_BUILD_ATOMIC` | Use atomic staging: write into a sibling temp dir before renaming into build.output_dir |
| `--no-atomic` | boolean | `LAUREL_BUILD_ATOMIC=0` | Disable atomic staging: write directly into build.output_dir instead of a sibling temp dir. Faster on slow filesystems but a mid-build failure leaves a half-written output and skips .laurelignore preservation; intended as an escape hatch for sandboxed CI runners where the rename-into-place step is restricted |
| `--concurrency <n>` | string | `LAUREL_BUILD_CONCURRENCY` | Cap on how many routes render in parallel (positive integer). Defaults to availableParallelism() (CPU count). Lower it on memory-constrained CI runners; raise it cautiously — the render path is CPU-bound on the single JS thread so values above CPU count rarely help |
| `--dry-run` | boolean | `LAUREL_BUILD_DRY_RUN` | Plan routes, load templates, and render every route into memory without writing anything to disk (no staging dir, no asset copies, no manifest, no sitemap/RSS/etc.). Prints the same summary line as a real build; pair with --verbose to also print a per-route table (URL, template, bytes, output path) |
| `--include-drafts` | boolean | `LAUREL_BUILD_INCLUDE_DRAFTS` | Include posts and pages whose status is not published or scheduled (`status: draft`, `needs-review`, or `approved`) in the build. Default is to exclude them so a forgotten WIP or in-review entry cannot accidentally ship. Emits a "Building with drafts" warning so the looser policy is visible in CI logs. LAUREL_DRAFTS=1 is honoured as a shorter env-var alias alongside the standard LAUREL_BUILD_INCLUDE_DRAFTS |
| `--force` | boolean | `LAUREL_BUILD_FORCE` | Ignore the previous build manifest (.laurel-manifest.json in the output dir) and re-render every route from scratch. Default behaviour reuses unchanged route HTML when the per-route hash (config + site + theme + template + route data) matches the last successful build; use --force as an escape hatch when the incremental cache appears stale or corrupted |
| `--clean` | boolean | `LAUREL_BUILD_CLEAN` | Delete stale files from build.output_dir after the current build completes. Enabled by default; pass --no-clean when the deploy target owns cleanup, such as hashed filenames retained across releases |
| `--no-clean` | boolean | `LAUREL_BUILD_CLEAN=0` | Skip stale-file cleanup in build.output_dir, preserving files that were not emitted by the current build |
| `--cache` | boolean | `LAUREL_BUILD_CACHE` | Use the previous build manifest to skip unchanged route HTML. Enabled by default; pass --no-cache to force every route to render without consulting the incremental cache |
| `--no-cache` | boolean | `LAUREL_BUILD_CACHE=0` | Force every route to render without consulting the incremental cache |
| `--progress` | boolean | `LAUREL_BUILD_PROGRESS` | Print human-readable build progress and summary lines to stdout. Interactive terminals show an in-place spinner and route counter such as `Rendering 12/150...`; piped output uses periodic plain progress logs. Enabled by default; pass --no-progress to keep warnings/errors on stderr while suppressing build progress output. This keeps warnings/errors visible when running `laurel build > build.log` |
| `--no-progress` | boolean | `LAUREL_BUILD_PROGRESS=0` | Suppress human-readable build progress and summary lines on stdout while keeping warnings/errors on stderr |
| `--copy-content-assets` | boolean | `LAUREL_BUILD_COPY_CONTENT_ASSETS` | Copy files from content.assets_dir into the output. Enabled by default from config; pass --no-copy-content-assets to skip that copy for this build |
| `--no-copy-content-assets` | boolean | `LAUREL_BUILD_COPY_CONTENT_ASSETS=0` | Skip copying files from content.assets_dir into the output |
| `-w, --watch` | boolean | `LAUREL_BUILD_WATCH` | After the initial build, keep the process alive and rebuild on changes to content/, theme/, and laurel.toml. Uses fs.watch with a 100ms debounce; no HTTP server (pair with `laurel serve` or an external static host). Errors in follow-up builds are logged but do not exit; Ctrl-C / SIGTERM stops the loop |
| `--emit-content-api` | boolean | `LAUREL_BUILD_EMIT_CONTENT_API` | Override `[components.content_api].enabled` for this build: passing the flag forces the Ghost Content API JSON shadows under `dist/content/` and `dist/ghost/api/content/` on regardless of the config. Without the flag and env var the config value (default `false`) is used |
| `--no-emit-content-api` | boolean | `LAUREL_BUILD_EMIT_CONTENT_API=0` | Force Ghost Content API JSON shadows off for this build without editing the config |
| `-j, --json` | boolean | `LAUREL_BUILD_JSON` | Emit the build completion event as one final JSON line ({ event: "build.done", routeCount, assetCount, outputDir, warningCount, renderedCount, skippedCount, dryRun }) on stdout for CI consumption. Human progress is suppressed; warnings/errors still go to stderr so `laurel build --json > build.jsonl` does not hide failures |

Examples:

```
laurel build                                 # one-shot build into dist/
laurel build --strict                        # fail when the build emits any warnings
laurel build --output dist-preview --base-path /preview/
laurel build --dry-run --verbose             # plan routes without writing anything
laurel build --profile                       # write timings and peak RSS to dist/.laurel-build-stats.json
BUN_INSPECT=1 laurel build --profile         # attach Bun inspector for heap snapshots while profiling
laurel build --watch                         # rebuild on content/theme/config changes
laurel build --json                          # emit the summary as JSON for CI
```

### `laurel build:email`

Render a theme email template for one post

Usage:

```
laurel build:email [--config <path>] [--output <dir>] [--post <slug>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_BUILD_EMAIL_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <dir>` | string | `LAUREL_BUILD_EMAIL_OUTPUT` | Override build.output_dir from the config (relative path inside the project root) |
| `--post <slug>` | string | `LAUREL_BUILD_EMAIL_POST` | Post slug to render through email.hbs or email-template.hbs. Email-only posts are supported. |
| `-j, --json` | boolean | `LAUREL_BUILD_EMAIL_JSON` | Emit the rendered email result as JSON ({ event, post, template, outputPath }) |

Examples:

```
laurel build:email --post=weekly-update
laurel build:email --post=weekly-update --output dist-email-preview
```

### `laurel new`

Scaffold a new Markdown content file

Usage:

```
laurel new [--config <path>] [--force] [--slug <slug>] [--draft] [--date <iso>] [--tags <a,b,c>] [--author <slug>] [--open] [--stdin] [--json] <kind> [title...]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<kind>` | required | Content kind to scaffold. Built-ins are post, page, tag, and author; additional kinds come from [content.kinds] and the active theme package config.content_kinds manifest. |
| `[title...]` | optional (variadic) | Title (post/page/custom kinds) or slug (tag/author); variadic so quoting is optional for multi-word titles. Optional for post/page/custom when --stdin provides a frontmatter title or first H1. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_NEW_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--force` | boolean | `LAUREL_NEW_FORCE` | Overwrite the destination file if it already exists |
| `--slug <slug>` | string | `LAUREL_NEW_SLUG` | Use this lowercase ASCII slug instead of one derived from the title (post/page/custom kinds only; must match /^[a-z0-9][a-z0-9-]*$/; for tag/author the positional already is the slug) |
| `--draft` | boolean | `LAUREL_NEW_DRAFT` | Set frontmatter status to "draft" so the file is excluded from builds until promoted (post/page only) |
| `--date <iso>` | string | `LAUREL_NEW_DATE` | Override the published date with an ISO-8601 timestamp instead of the current time (post only). Without --date, UTC is used unless [site].timezone configures an IANA timezone; use an explicit offset when preserving a source editorial wall-clock value. |
| `--tags <a,b,c>` | string | `LAUREL_NEW_TAGS` | Tag slugs to seed in frontmatter (post only); repeat or comma-separate |
| `--author <slug>` | string | `LAUREL_NEW_AUTHOR` | Author slug to seed in frontmatter (post only) |
| `--open` | boolean | `LAUREL_NEW_OPEN` | Open the created file in $VISUAL or $EDITOR after writing it (logs the path when neither is set) |
| `--stdin` | boolean | `LAUREL_NEW_STDIN` | Read Markdown body content from stdin. If the title positional is omitted for post/page/custom kinds, derive it from stdin frontmatter title or the first H1; frontmatter slug is used when --slug is omitted. |
| `-j, --json` | boolean | `LAUREL_NEW_JSON` | Emit the result (created path, slug, kind) as JSON on stdout instead of the human "Created ..." line |

Examples:

```
laurel new post "Hello World"               # content/posts/hello-world.md
laurel new post "日本語タイトル" --slug japanese-title
laurel new post "Draft Idea" --draft        # status: draft so the build skips it
laurel new post "Tagged" --tags news,tech --author jane
cat post.md | laurel new post --stdin       # derive title/body from Markdown stdin
laurel new tag releases                      # content/tags/releases.md
laurel new author jane                       # content/authors/jane.md
laurel new event "Launch Party"              # custom kind from config/theme manifest
```

### `laurel open`

Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match

Usage:

```
laurel open [--config <path>] [--kind <posts|pages>] [--json] [slug]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[slug]` | optional | Slug of the post or page to open (e.g. `hello-world`) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_OPEN_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--kind <posts\|pages>` | string | `LAUREL_OPEN_KIND` | Restrict the lookup to `posts` or `pages` (default: search both). When a slug exists under both kinds the explicit hint avoids the ambiguity error |
| `-j, --json` | boolean | `LAUREL_OPEN_JSON` | Emit the resolved file path (and slug/kind) as JSON on stdout instead of spawning $EDITOR. Useful for piping into other tooling |

Examples:

```
laurel open hello-world                      # opens content/posts/hello-world.md
laurel open about --kind pages
EDITOR=code laurel open hello-world          # respects $EDITOR
```

### `laurel test`

Run the project test suite via Bun test (passthrough placeholder)

Usage:

```
laurel test [args...]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[args...]` | optional (variadic) | Arguments forwarded to `bun test` after Laurel prints a passthrough warning |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |

Examples:

```
laurel test                                  # run bun test
laurel test tests/cli/parse.test.ts          # forward a path to bun test
```

### `laurel dev`

Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser

Usage:

```
laurel dev [--config <path>] [--port <n>] [--host <host>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_DEV_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-p, --port <n>` | string | `LAUREL_DEV_PORT` | Port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port for CI/smoke tests) |
| `--host <host>` | string | `LAUREL_DEV_HOST` | Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |
| `-j, --json` | boolean | `LAUREL_DEV_JSON` | Switch logger output (status / rebuild events) to one JSON object per line for CI / log forwarders. Accepted globally; flag here just makes it visible in `--help` |

Examples:

```
laurel dev                                   # http://localhost:4321 with live reload
laurel dev --port 8080                       # pick a different port
laurel dev --host 0.0.0.0                    # expose on the LAN (mobile testing)
```

### `laurel serve`

Serve the built site as a local preview server; not for production hosting

Usage:

```
laurel serve [--port <n>] [--host <host>] [--watch] [--no-watch] [--build] [--open] [--simulate <target>] [--compression <auto|gzip|br|none>] [--proxy <api-base>] [--tls-cert <file>] [--tls-key <file>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-p, --port <n>` | string | `LAUREL_SERVE_PORT` | Port to listen on (1..65535 integer; defaults to 4321) |
| `--host <host>` | string | `LAUREL_SERVE_HOST` | Hostname to bind to (defaults to 127.0.0.1 for local-only preview; pass 0.0.0.0 to expose on the LAN) |
| `-w, --watch` | boolean | `LAUREL_SERVE_WATCH` | Enable the default rebuild-on-change loop while serving dist/ |
| `--no-watch` | boolean | `LAUREL_SERVE_WATCH=0` | Disable the default rebuild-on-change loop; serve dist/ as a static snapshot |
| `-b, --build` | boolean | `LAUREL_SERVE_BUILD` | Run a full build before starting the server, regardless of whether dist/ already exists |
| `--open` | boolean | `LAUREL_SERVE_OPEN` | Open the served URL in the default browser after the server starts |
| `--simulate <target>` | string | `LAUREL_SERVE_SIMULATE` | Simulate deploy-target redirects and headers from emitted artifacts while serving locally. Supported targets: netlify, cloudflare-pages, vercel |
| `--compression <auto\|gzip\|br\|none>` | string | `LAUREL_SERVE_COMPRESSION` | Compress local responses when the client supports it. Use auto to prefer br then gzip; default is none |
| `--proxy <api-base>` | string | `LAUREL_SERVE_PROXY` | Proxy missing Content API requests (/ghost/api/* and /content/*) to this upstream base URL |
| `--tls-cert <file>` | string | `LAUREL_SERVE_TLS_CERT` | Path to a local TLS certificate PEM for serving https:// previews |
| `--tls-key <file>` | string | `LAUREL_SERVE_TLS_KEY` | Path to the matching local TLS private key PEM |
| `-j, --json` | boolean | `LAUREL_SERVE_JSON` | Switch logger output (rebuild events / lifecycle) to one JSON object per line for CI / log forwarders |

Examples:

```
laurel serve                                 # local preview of dist/ + rebuild on change
laurel serve --no-watch                      # serve dist/ as a static snapshot
laurel serve --open                          # open the local preview in a browser
laurel serve --simulate netlify --no-watch   # apply emitted _headers/_redirects locally
laurel serve --compression auto              # enable br/gzip negotiation
laurel serve --proxy https://ghost.example.com
laurel serve --tls-cert cert.pem --tls-key key.pem
laurel serve --build                         # build first, then serve
laurel serve --port 8080 --host 0.0.0.0
```

### `laurel dashboard`

Run the local file-backed editorial dashboard

Usage:

```
laurel dashboard [--config <path>] [--dev] [--no-build] [--port <n>] [--host <host>] [--open] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_DASHBOARD_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--dev` | boolean | `LAUREL_DASHBOARD_DEV` | Run the dashboard with Bun's fullstack dev server (HMR for src/cli/dashboard/web/**; no pre-built bundle required) |
| `--no-build` | boolean | `LAUREL_DASHBOARD_NO_BUILD` | Skip the prod-from-source auto-build and serve the embedded/pre-built bundle as-is (fast restart; no effect on --dev or the published CLI) |
| `-p, --port <n>` | string | `LAUREL_DASHBOARD_PORT` | Port to listen on (0..65535 integer; defaults to 4322; pass 0 to let the kernel pick a free port) |
| `--host <host>` | string | `LAUREL_DASHBOARD_HOST` | Hostname to bind to (defaults to 127.0.0.1 for local-only file editing; pass 0.0.0.0 to expose on the LAN) |
| `--open` | boolean | `LAUREL_DASHBOARD_OPEN` | Open the dashboard in the default browser after the server starts |
| `-j, --json` | boolean | `LAUREL_DASHBOARD_JSON` | Switch logger output (lifecycle events) to one JSON object per line for CI / log forwarders |

Examples:

```
laurel dashboard                             # http://127.0.0.1:4322 local dashboard
laurel dashboard --open                      # launch the browser after startup
laurel dashboard --port 0                    # pick a free port for smoke tests
laurel dashboard --host 0.0.0.0              # expose on the LAN
laurel dashboard --dev                       # frontend HMR; bundles TSX/CSS on demand
laurel dashboard --no-build                  # serve the embedded bundle without rebuilding
```

### `laurel check`

Validate config, theme, and content

Usage:

```
laurel check [--config <path>] [--strict] [--check-links] [--check-external] [--check-frontmatter] [--check-templates] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_CHECK_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--strict` | boolean | `LAUREL_CHECK_STRICT` | Exit with non-zero status if any warnings were emitted during the check |
| `--check-links` | boolean | `LAUREL_CHECK_CHECK_LINKS` | Scan every post/page body for relative `[text](./foo.md)` cross-links and relative image references; warn if any do not resolve to a known post/page or an existing file. Opt-in because it re-reads every body during check |
| `--check-external` | boolean | `LAUREL_CHECK_CHECK_EXTERNAL` | Probe each external http(s) URL in navigation (and post/page bodies when --check-links is also set) with a HEAD request; warn on non-2xx, timeout, or network failure. Opt-in because it hits the network and is slow; per-URL timeout defaults to 5s |
| `--check-frontmatter` | boolean | `LAUREL_CHECK_CHECK_FRONTMATTER` | Walk content/posts/**/*.md and content/pages/**/*.md and validate each frontmatter block against the schema (required title, date format, status one of published/draft/scheduled/needs-review/approved, …). Off by default because it re-reads every file; pair with --strict in CI to fail on warnings |
| `--check-templates` | boolean | `LAUREL_CHECK_CHECK_TEMPLATES` | Cross-check the active theme against the route plan: warn when a route would request a template name (post, page, tag, author, index, default) that does not exist in the theme. Stops a typo in a route layout from rendering through the default fallback unnoticed |
| `-j, --json` | boolean | `LAUREL_CHECK_JSON` | Emit the check report as JSON ({ ok, errors: [...], warnings: [...] }) on stdout for CI consumption. Each entry includes file, line, message, and code |

Examples:

```
laurel check                                 # config + theme + content validation
laurel check --strict                        # fail on any warning (use in CI)
laurel check --check-frontmatter --check-templates
laurel check --check-links                   # also resolve relative markdown links
laurel check --json | jq                     # machine-readable findings
```

### `laurel doctor`

Run health checks on the project (bun, config, theme, content, network)

Usage:

```
laurel doctor [--config <path>] [--json] [--network] [--no-network]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_DOCTOR_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `LAUREL_DOCTOR_JSON` | Emit results as JSON (for CI consumption) |
| `--network` | boolean | `LAUREL_DOCTOR_NETWORK` | Run the network reachability check |
| `--no-network` | boolean | `LAUREL_DOCTOR_NETWORK=0` | Skip the network reachability check |

Examples:

```
laurel doctor                                # full project health check
laurel doctor --no-network                   # skip the connectivity probe
laurel doctor --json                         # machine-readable for CI
```

### `laurel diagnostics`

Create support-safe diagnostics bundles

Usage:

```
laurel diagnostics [--config <path>] [--output <file>] [--log-lines <n>] [--dry-run] [--list] [--json] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `bundle` (write a redacted diagnostics .tar.gz) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_DIAGNOSTICS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <file>` | string | `LAUREL_DIAGNOSTICS_OUTPUT` | Path for the .tar.gz bundle. Defaults to laurel-diagnostics-<timestamp>.tar.gz in the current directory |
| `--log-lines <n>` | string | `LAUREL_DIAGNOSTICS_LOG_LINES` | Maximum number of lines to include from each known Laurel log file. Defaults to 200; use 0 to omit log text while still listing log candidates |
| `--dry-run` | boolean | `LAUREL_DIAGNOSTICS_DRY_RUN` | Print the archive path and entry list without writing a bundle. Useful for auditing what support artifacts would be collected |
| `--list` | boolean | `LAUREL_DIAGNOSTICS_LIST` | Alias for --dry-run: list planned bundle entries without writing the archive |
| `-j, --json` | boolean | `LAUREL_DIAGNOSTICS_JSON` | Emit the bundle result as JSON ({ output, entries, bytes, dryRun }) for CI or support scripts |

Examples:

```
laurel diagnostics bundle
laurel diagnostics bundle --output support/laurel-diagnostics.tar.gz
laurel diagnostics bundle --dry-run
laurel diagnostics bundle --log-lines 50 --json
```

### `laurel clean`

Remove dist/ and .laurel/cache build artifacts

Usage:

```
laurel clean [--config <path>] [--yes] [--dry-run] [--keep <path[,path...]>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_CLEAN_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-y, --yes` | boolean | `LAUREL_CLEAN_YES` | Skip the confirmation prompt and delete immediately (non-interactive use) |
| `--dry-run` | boolean | `LAUREL_CLEAN_DRY_RUN` | Print the paths that would be removed without actually deleting them. Implies non-interactive. |
| `--keep <path[,path...]>` | string | `LAUREL_CLEAN_KEEP` | Path (relative to cwd) to preserve inside the targets. Repeat or comma-separate values (e.g. "dist/.well-known,dist/uploads") to keep multiple entries |
| `-j, --json` | boolean | `LAUREL_CLEAN_JSON` | Emit the deletion summary as JSON (paths, kept, bytes) for CI consumption |

Examples:

```
laurel clean                                 # interactive; asks before deleting
laurel clean --yes                           # non-interactive (CI/scripts)
laurel clean --dry-run                       # show what would be removed
laurel clean --keep dist/.well-known --yes   # preserve specific paths
```

### `laurel cache`

Inspect or remove the local .laurel/cache directory

Usage:

```
laurel cache [--dry-run] [--json] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `dir` (print cache path), `stats` (file count and bytes), or `clean` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--dry-run` | boolean | `LAUREL_CACHE_DRY_RUN` | For `clean`: print what would be removed without deleting the cache |
| `-j, --json` | boolean | `LAUREL_CACHE_JSON` | Emit cache path, stats, or clean result as JSON |

Examples:

```
laurel cache dir
laurel cache stats --json
laurel cache clean --dry-run
laurel cache clean
```

### `laurel completions`

Print or install a shell completion script

Usage:

```
laurel completions [--json] [--shell <auto|bash|zsh|fish|pwsh>] [shell-or-action] [install-shell]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[shell-or-action]` | optional | Target shell (bash, zsh, fish, pwsh) or `install` |
| `[install-shell]` | optional | Optional install target shell: auto, bash, zsh, fish, or pwsh |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-j, --json` | boolean | `LAUREL_COMPLETIONS_JSON` | No-op for `completions`; accepted so the global `--json` flag does not error here. The output is always shell-script text |
| `--shell <auto\|bash\|zsh\|fish\|pwsh>` | string | `LAUREL_COMPLETIONS_SHELL` | Shell to install completions for: auto, bash, zsh, fish, or pwsh |

Examples:

```
laurel completion bash >> ~/.bashrc         # singular alias
laurel completions bash >> ~/.bashrc
laurel completions zsh > ~/.zsh/_laurel
laurel completions fish > ~/.config/fish/completions/laurel.fish
laurel completions install                 # install for the detected shell
laurel completions install --shell zsh     # install under a user-writable zsh path
```

### `laurel config`

Inspect or update the loaded Laurel config

Usage:

```
laurel config [--config <path>] [--json] [--format <json|toml>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `print` (dump the fully resolved config after defaults, env overrides, and config layers), `validate` (load config only and exit 0/1), `get <dotted.key>` (print one value), `set <dotted.key> <value>` (write a string/number/bool), or `path` (print the detected config path and project .laurelrc path/status) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_CONFIG_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `LAUREL_CONFIG_JSON` | Emit the value as JSON. For `print`: equivalent to `--format json`. For `validate`: emit `{ ok, errors }`. For `get`: pretty-printed JSON of the value at the dotted path. For `set`: a `{ "config_path": "..." }` envelope. For `path`: a `{ "config_path": "...", "rc_path": "..." }` envelope so CI consumers can branch on `null` for missing files. |
| `--format <json\|toml>` | string | `LAUREL_CONFIG_FORMAT` | For `print`, choose the resolved config output format: `toml` (default) or `json`. |

Examples:

```
laurel config print                          # resolved config as TOML
laurel config print --format json            # resolved config as JSON
laurel config validate                       # config-only validation
laurel config path                           # detected config and .laurelrc paths
laurel config get site.url
laurel config set site.title "My Site"
laurel config set components.rss.enabled false
laurel config get build.base_path --json
```

### `laurel schema`

Print JSON Schema for Laurel config, frontmatter, or theme package.json

Usage:

```
laurel schema <target>
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
laurel schema config > laurel.config.schema.json
laurel schema frontmatter > laurel.frontmatter.schema.json
laurel schema theme > laurel.theme.schema.json
```

### `laurel skill`

Install bundled agent skills (Claude Code / Codex) so AI assistants understand how to work in this Laurel project

Usage:

```
laurel skill [--format <list>] [--json] <subcommand> [slug...]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `list`, `install`, or `remove` |
| `[slug...]` | optional (variadic) | Skill slug(s); omit for `install` to install all bundled skills |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--format <list>` | string | `LAUREL_SKILL_FORMAT` | Comma-separated list of agent formats to target: `claude`, `codex`, or `all`. Defaults to auto-detect via CLAUDE.md / AGENTS.md presence |
| `-j, --json` | boolean | `LAUREL_SKILL_JSON` | `list` only: emit the skill catalog as JSON for CI / scripting |

Examples:

```
laurel skill list
laurel skill install                                # auto-detect + install all
laurel skill install frontmatter-authoring          # one skill
laurel skill install --format codex                 # only emit Codex format
laurel skill install --format all                   # emit every format
laurel skill remove build-troubleshoot
```

### `laurel content`

Inspect or modify content in the project (posts, pages)

Usage:

```
laurel content [--config <path>] [--kind <posts|pages>] [--lines <n>] [--frontmatter] [--draft] [--tag <slug>] [--author <slug>] [--json] [--redirect] [--purge] [--date <iso|now>] [--published] [--published-at <iso|now>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show posts/pages), `show <slug>` (print frontmatter + body preview), `rename <old-slug> <new-slug>` (move a post/page file + rewrite its `slug` frontmatter), `delete <slug>` (move content into `.laurel/trash/` with restore metadata), or `touch <slug>` (update date frontmatter) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_CONTENT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--kind <posts\|pages>` | string | `LAUREL_CONTENT_KIND` | For `list`: filter by content kind (posts or pages). For `show`, `delete`, and `touch`: restrict slug lookup to one kind (default searches posts then pages). For `rename`: which kind to look up the slug under (defaults to posts; pass `pages` to rename a page slug instead) |
| `--lines <n>` | string | `LAUREL_CONTENT_LINES` | For `show`: number of body lines to print after the frontmatter (default: 20) |
| `--frontmatter` | boolean | `LAUREL_CONTENT_FRONTMATTER` | For `show`: print only the YAML frontmatter block, without body preview lines |
| `--draft` | boolean | `LAUREL_CONTENT_DRAFT` | Include draft posts/pages in the listing (default: only published; `list` only) |
| `--tag <slug>` | string | `LAUREL_CONTENT_TAG` | Show only entries that have any given tag slug (`list` only); repeat or comma-separate |
| `--author <slug>` | string | `LAUREL_CONTENT_AUTHOR` | Show only entries that have any given author slug (`list` only); repeat or comma-separate |
| `-j, --json` | boolean | `LAUREL_CONTENT_JSON` | Emit results as JSON for CI consumption (`list`, `show`, `rename`, `delete`, and `touch`) |
| `--redirect` | boolean | `LAUREL_CONTENT_REDIRECT` | On `rename`: append a `<old-url>  <new-url>  301` entry to `redirects.yaml` at the project root so the old URL keeps working when emitted through the redirects component |
| `--purge` | boolean | `LAUREL_CONTENT_PURGE` | On `delete`: permanently remove matching entries from `.laurel/trash/` only when they are at least 30 days old. Never removes current content files |
| `--date <iso\|now>` | string | `LAUREL_CONTENT_DATE` | On `touch`: set `updated_at` to this ISO-8601 timestamp instead of the current time; `now` is also accepted |
| `--published` | boolean | `LAUREL_CONTENT_PUBLISHED` | On `touch`: update `published_at` to the same timestamp as `updated_at` |
| `--published-at <iso\|now>` | string | `LAUREL_CONTENT_PUBLISHED_AT` | On `touch`: set `published_at` to this ISO-8601 timestamp (or `now`) while also updating `updated_at` |

Examples:

```
laurel content list                          # posts + pages with status/date
laurel content list --kind pages
laurel content list --tag changelog --json
laurel content show hello-world --lines 12
laurel content show about --kind pages --frontmatter
laurel content rename old-slug new-slug --redirect
laurel content delete old-slug
laurel content delete --purge old-slug
laurel content touch hello-world --date 2026-01-02T03:04:05Z
laurel content touch about --kind pages --published
```

### `laurel redirects`

Inspect redirect rules loaded from redirects.yaml and Ghost exports

Usage:

```
laurel redirects [--collapsed] [--json] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `list` (print redirect rules) or `validate` (parse and report duplicates) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--collapsed` | boolean | `LAUREL_REDIRECTS_COLLAPSED` | Show the first-match rule set after dropping later duplicate source paths (`list` only) |
| `-j, --json` | boolean | `LAUREL_REDIRECTS_JSON` | Emit redirect validation or inventory as JSON |

Examples:

```
laurel redirects list
laurel redirects list --collapsed --json
laurel redirects validate
```

### `laurel info`

Print Laurel, Bun, and project environment information

Usage:

```
laurel info [--config <path>] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_INFO_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `LAUREL_INFO_JSON` | Emit the report as JSON for CI consumption |

Examples:

```
laurel info                                  # human-readable summary
laurel info --json                           # machine-readable; same payload
laurel env                                   # alias for `laurel info`
```

### `laurel lint`

Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter)

Usage:

```
laurel lint [--config <path>] [--json] [--strict] [--max-title-length <n>]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_LINT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-j, --json` | boolean | `LAUREL_LINT_JSON` | Emit findings as JSON ({ count, findings: [{ rule, severity, file, message }] }) for CI consumption |
| `--strict` | boolean | `LAUREL_LINT_STRICT` | Exit with non-zero status if any warning-level findings were emitted (errors always exit non-zero) |
| `--max-title-length <n>` | string | `LAUREL_LINT_MAX_TITLE_LENGTH` | Override the max title length before a warning is emitted (default: 70 characters; Google SERP cut-off rule of thumb) |

Examples:

```
laurel lint                                  # warn-level summary table
laurel lint --strict                         # exit non-zero on any warning
laurel lint --json | jq                      # CI-friendly findings stream
laurel lint --max-title-length 60
```

### `laurel fmt`

Format content Markdown frontmatter in place

Usage:

```
laurel fmt [--config <path>] [--check]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_FMT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--check` | boolean | `LAUREL_FMT_CHECK` | Check whether content Markdown frontmatter is already formatted without writing changes. Exits 1 when any file would change |

Examples:

```
laurel fmt                                   # rewrite content frontmatter in place
laurel fmt --check                           # CI check; exits 1 when formatting is needed
```

### `laurel tags`

Inspect or modify tags in the project

Usage:

```
laurel tags [--config <path>] [--orphaned] [--unused] [--json] [--dry-run] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show tags), `rename <old-slug> <new-slug>`, or `merge <from> [from...] <into>` (rewrite post/page tag references and safely handle tag files) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_TAGS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--orphaned` | boolean | `LAUREL_TAGS_ORPHANED` | Show only tags that are defined under content/tags/ but referenced by zero posts (`list` only) |
| `--unused` | boolean | `LAUREL_TAGS_UNUSED` | Alias for --orphaned (`list` only) |
| `-j, --json` | boolean | `LAUREL_TAGS_JSON` | Emit results as JSON for CI consumption (`list`, `rename`, and `merge`) |
| `--dry-run` | boolean | `LAUREL_TAGS_DRY_RUN` | On `rename`/`merge`: scan and report the files that would change without writing anything |

Examples:

```
laurel tags list                             # all tags + post counts
laurel tags list --orphaned                  # tags defined but unused
laurel tags rename old-tag new-tag
laurel tags rename old new --dry-run         # preview files that would change
laurel tags merge draft old canonical --dry-run
```

### `laurel authors`

Inspect or modify authors in the project

Usage:

```
laurel authors [--config <path>] [--orphaned] [--json] [--dry-run] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show authors and post counts) or `rename <old-slug> <new-slug>` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_AUTHORS_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--orphaned` | boolean | `LAUREL_AUTHORS_ORPHANED` | Show only authors that are defined under content/authors/ but referenced by zero posts (`list` only) |
| `-j, --json` | boolean | `LAUREL_AUTHORS_JSON` | Emit results as JSON for CI consumption (`list` and `rename`) |
| `--dry-run` | boolean | `LAUREL_AUTHORS_DRY_RUN` | On `rename`: scan and report the files that would change without writing anything |

Examples:

```
laurel authors list                          # all authors + post counts
laurel authors list --orphaned               # authors defined but unused by posts
laurel authors list --json                   # machine-readable author inventory
laurel authors rename old-author new-author
laurel authors rename old new --dry-run       # preview files that would change
```

### `laurel theme`

Manage themes in the project. `list` shows available themes; `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive; `lint <path>` checks a theme directory for required templates / helpers / partials; `serve` runs a fast fixture-backed theme dev server

Usage:

```
laurel theme [--config <path>] [--from <theme-name>] [--output <path>] [--force] [--json] [--port <n>] [--host <host>] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show themes under theme.dir), `new <name>` (scaffold themes/<name>/), `zip` (archive the active theme into a gscan-compatible .zip), `lint <path>` (audit a theme directory), or `serve` (fast theme dev server) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_THEME_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--from <theme-name>` | string | `LAUREL_THEME_FROM` | `new` only: copy from an existing theme directory under `themes/` instead of writing the minimal default scaffold |
| `-o, --output <path>` | string | `LAUREL_THEME_OUTPUT` | `zip` only: output path for the archive (defaults to `<name>-<version>.zip` in the current directory) |
| `--force` | boolean | `LAUREL_THEME_FORCE` | Overwrite the destination directory (`new`) or archive (`zip`) if it already exists |
| `-j, --json` | boolean | `LAUREL_THEME_JSON` | `list` / `lint`: emit JSON instead of the default table |
| `-p, --port <n>` | string | `LAUREL_THEME_PORT` | `serve` only: port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port) |
| `--host <host>` | string | `LAUREL_THEME_HOST` | `serve` only: hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN) |

Examples:

```
laurel theme list                            # show themes under theme.dir
laurel theme list --json                     # machine-readable theme list
laurel theme new my-theme                    # scaffold themes/my-theme/
laurel theme new my-fork --from source       # fork the active theme
laurel theme zip                             # ship-ready zip in cwd
laurel theme lint themes/my-theme            # audit before shipping
laurel theme serve                           # fast theme dev server using fixture content
laurel theme serve --port 8080               # pick a different port
laurel theme:lint themes/my-theme            # colon-style alias
```

### `laurel migrate`

Convert content from another platform into Laurel Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>`

Usage:

```
laurel migrate [--on-conflict <skip|overwrite|rename>] [--dry-run] [--assets <dir>] [--download-images] [--max-image-size <size>] [--source-url <url>] [--max-size <size>] [--max-post-html-size <size>] [--keep-code-injection] [--json] <source-and-args...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<source-and-args...>` | required (variadic) | `<source> <path>` where source is one of `ghost`, `wordpress`, `hugo`, `jekyll`, `eleventy` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_MIGRATE_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename (ghost/wordpress only) |
| `--dry-run` | boolean | `LAUREL_MIGRATE_DRY_RUN` | Parse the source and print a summary of what would land without writing files (ghost/wordpress only; hugo/jekyll/eleventy print a copy plan) |
| `--assets <dir>` | string | `LAUREL_MIGRATE_ASSETS` | ghost only: path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `--download-images` | boolean | `LAUREL_MIGRATE_DOWNLOAD_IMAGES` | ghost only: download Ghost content image/media URLs into content/images/ and rewrite references to local paths; third-party service URLs stay external |
| `--max-image-size <size>` | string | `LAUREL_MIGRATE_MAX_IMAGE_SIZE` | ghost only: per-image size cap when --download-images is set (e.g. 10MB; default 10MB; 0 disables) |
| `--source-url <url>` | string | `LAUREL_MIGRATE_SOURCE_URL` | ghost only: absolute URL of the source Ghost site; rewrites in-body links pointing at this host to site-relative paths |
| `--max-size <size>` | string | `LAUREL_MIGRATE_MAX_SIZE` | ghost only: max JSON export size before refusing to parse (e.g. 256MB; default 256MB; 0 disables) |
| `--max-post-html-size <size>` | string | `LAUREL_MIGRATE_MAX_POST_HTML_SIZE` | ghost only: per-post rendered HTML size cap before Turndown conversion (e.g. 5MB; default 5MB; 0 disables) |
| `--keep-code-injection` | boolean | `LAUREL_MIGRATE_KEEP_CODE_INJECTION` | ghost only: preserve codeinjection_head / codeinjection_foot verbatim. Off by default; only enable when you trust the source. |
| `-j, --json` | boolean | `LAUREL_MIGRATE_JSON` | Emit the migration summary as JSON on stdout for CI consumption |

Examples:

```
laurel migrate ghost export.json
laurel migrate ghost export.zip --on-conflict overwrite
laurel migrate wordpress export.xml
laurel migrate hugo ./old-hugo-site --dry-run
laurel migrate jekyll ./old-jekyll-site
```

### `laurel deploy`

Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync

Usage:

```
laurel deploy [--config <path>] [--build] [--target <target>] [--dry-run] [--preflight] [--project-name <name>] [--branch <name>] [--site-id <id>] [--prod] [--bucket <name>] [--region <region>] [--endpoint <url>] [--destination <user@host:path>] [--remote <name>] [--json] [target]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `[target]` | optional | Hosting target: `cloudflare`, `netlify`, `vercel`, `github-pages`, `s3`, `r2`, or `rsync`. May also be passed as `--target <target>` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_DEPLOY_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-b, --build` | boolean | `LAUREL_DEPLOY_BUILD` | Run `laurel build` before deploying so the publish step always uses fresh artifacts. Without this flag the command refuses to deploy when `dist/` is missing or has no `.laurel-manifest.json` (the build pre-flight); set it for one-shot deploys from CI without a separate build step |
| `--target <target>` | string | `LAUREL_DEPLOY_TARGET` | Hosting target as a flag form for CI templates that prefer named options. Equivalent to the positional <target> |
| `--dry-run` | boolean | `LAUREL_DEPLOY_DRY_RUN` | Print the external command(s), files that would be deployed for the selected target, and the changed-path diff from the last build without spawning anything |
| `--preflight` | boolean | `LAUREL_DEPLOY_PREFLIGHT` | s3 only: before syncing, run `aws s3api get-bucket-policy-status` and warn when the bucket policy is public |
| `--project-name <name>` | string | `LAUREL_DEPLOY_PROJECT_NAME` | cloudflare only: Cloudflare Pages project name forwarded to `wrangler pages deploy --project-name=<name>`. Overrides `[deploy.cloudflare].project_name`. Required for cloudflare when not set in config |
| `--branch <name>` | string | `LAUREL_DEPLOY_BRANCH` | cloudflare: branch label forwarded to `wrangler pages deploy --branch=<name>`. github-pages: branch to push the site to (defaults to `[deploy.github_pages].branch` or `gh-pages`) |
| `--site-id <id>` | string | `LAUREL_DEPLOY_SITE_ID` | netlify only: Netlify site id forwarded to `netlify deploy --site=<id>`. Overrides `[deploy.netlify].site_id` |
| `--prod` | boolean | `LAUREL_DEPLOY_PROD` | netlify, vercel: explicitly pass `--prod`. Default `true` for both via config (`[deploy.<target>].prod`); pair with `--prod=false`-equivalent LAUREL_DEPLOY_PROD=0 env var when the CLI flag is unsuitable |
| `--bucket <name>` | string | `LAUREL_DEPLOY_BUCKET` | s3 / r2: target bucket name. Forwarded to `aws s3 sync dist s3://<bucket>`. Overrides the matching `[deploy.s3].bucket` or `[deploy.r2].bucket` config entry |
| `--region <region>` | string | `LAUREL_DEPLOY_REGION` | s3 only: AWS region forwarded as `--region <region>` to `aws s3 sync`. Overrides `[deploy.s3].region` |
| `--endpoint <url>` | string | `LAUREL_DEPLOY_ENDPOINT` | r2 only: R2 S3-compatible endpoint URL forwarded as `--endpoint-url <url>` to `aws s3 sync`. Overrides `[deploy.r2].endpoint` |
| `--destination <user@host:path>` | string | `LAUREL_DEPLOY_DESTINATION` | rsync only: destination string (e.g. `user@host:/var/www/site/`). Overrides `[deploy.rsync].destination` |
| `--remote <name>` | string | `LAUREL_DEPLOY_REMOTE` | github-pages only: git remote forwarded to `git push <remote> <branch>` (defaults to `[deploy.github_pages].remote` or `origin`) |
| `-j, --json` | boolean | `LAUREL_DEPLOY_JSON` | Emit the deploy plan / outcome as JSON on stdout for CI consumption |

Examples:

```
laurel deploy cloudflare --project-name my-blog --build
laurel deploy netlify --site-id abc123
laurel deploy vercel --prod
laurel deploy github-pages --branch gh-pages
laurel deploy rsync --destination user@host:/var/www/site/
laurel deploy s3 --bucket my-bucket --region us-east-1 --dry-run
laurel deploy s3 --bucket my-bucket --region us-east-1 --preflight
```

### `laurel export`

Dump the loaded content, a single entry bundle, a components bundle, or regenerate the RSS feed without running a full build

Usage:

```
laurel export [--config <path>] [--output <path>] [--slugs <a,b,c>] [--pretty] [--include-drafts] [--kind <post|page>] [--json] <format> [slug]
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<format>` | required | Export format: `json` (Laurel content graph), `ghost-json` (Ghost backup-shaped {db: [{data: {posts, pages, tags, users, posts_tags, posts_authors}}]}), `rss` (RSS 2.0 XML), `entry` (zip entry-bundle for a single post or page), or `components` (zip bundle of reusable component snippets for handoff) |
| `[slug]` | optional | Entry slug when format is `entry` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_EXPORT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `-o, --output <path>` | string | `LAUREL_EXPORT_OUTPUT` | Path to write the export to. For `entry` defaults to `<slug>.laurel.zip`; for `components` defaults to `components.laurel.zip`; for other formats defaults to stdout. Parent directories are created as needed; existing files are overwritten |
| `--slugs <a,b,c>` | string | `LAUREL_EXPORT_SLUGS` | For `components` format: comma-separated component slugs to export. Omit to export every component |
| `--pretty` | boolean | `LAUREL_EXPORT_PRETTY` | Pretty-print JSON output with 2-space indentation (`json` and `ghost-json` only). Default emits compact JSON |
| `--include-drafts` | boolean | `LAUREL_EXPORT_INCLUDE_DRAFTS` | Include posts and pages with `status: draft` in the export. Off by default so an unintended draft cannot leak through `laurel export` |
| `--kind <post\|page>` | string | `LAUREL_EXPORT_KIND` | For `entry` format: content kind to export (`post` or `page`). Defaults to `post` |
| `-j, --json` | boolean | `LAUREL_EXPORT_JSON` | No-op here; `export` already emits its own format-specific payload (json/ghost-json/rss). Accepted so the global `--json` flag does not error |

Examples:

```
laurel export json > content.json
laurel export json --pretty -o snapshot.json
laurel export ghost-json -o ghost-backup.json
laurel export rss -o feed.xml
laurel export entry hello-world
laurel export entry hello-world -o out.laurel.zip
laurel export entry about --kind page -o about.laurel.zip
laurel export components                       # every component
laurel export components --slugs callout,cta -o snippets.laurel.zip
```

### `laurel import`

Import a Laurel zip bundle: an entry (post or page) or a components bundle

Usage:

```
laurel import [--config <path>] [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <kind> <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<kind>` | required | Import kind: `entry` (a single post/page bundle; the manifest carries the post/page kind) or `components` (a bulk components bundle) |
| `<file>` | required | Path to a `.laurel.zip` bundle (entry or components) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-c, --config <path>` | string | `LAUREL_IMPORT_CONFIG` | Config path(s); repeat or comma-separate to deep-merge in order |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_IMPORT_ON_CONFLICT` | How to handle existing files: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `LAUREL_IMPORT_DRY_RUN` | Validate the bundle and report planned writes without changing files |
| `-j, --json` | boolean | `LAUREL_IMPORT_JSON` | No-op here; `import` always emits a JSON result. Accepted so the global `--json` flag does not error |

Examples:

```
laurel import entry hello-world.laurel.zip
laurel import entry hello-world.laurel.zip --dry-run
laurel import entry hello-world.laurel.zip --on-conflict rename
laurel import entry hello-world.laurel.zip --on-conflict overwrite
laurel import components components.laurel.zip
laurel import components components.laurel.zip --on-conflict overwrite
```

### `laurel upgrade`

Upgrade the installed Laurel CLI when the install method supports it

Usage:

```
laurel upgrade [--dry-run] [--json]
```

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--dry-run` | boolean | `LAUREL_UPGRADE_DRY_RUN` | Print the detected upgrade command without running it |
| `-j, --json` | boolean | `LAUREL_UPGRADE_JSON` | Emit the upgrade plan or result as JSON |

Examples:

```
laurel upgrade
laurel upgrade --dry-run
LAUREL_NO_UPDATE_CHECK=1 laurel upgrade       # skip self-update checks and actions
```

### `laurel telemetry`

Manage opt-in anonymous usage telemetry

Usage:

```
laurel telemetry [--endpoint <url>] <subcommand>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand>` | required | `enable`, `disable`, or `status` |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--endpoint <url>` | string | `LAUREL_TELEMETRY_ENDPOINT` | Set the stored telemetry endpoint when enabling. LAUREL_TELEMETRY_ENDPOINT overrides it per run |

Examples:

```
laurel telemetry status
laurel telemetry enable
laurel telemetry enable --endpoint https://telemetry.example.test/v1/usage
LAUREL_TELEMETRY_ENDPOINT=http://127.0.0.1:8787/usage laurel build
laurel telemetry disable
```

### `laurel plugins`

Inspect future Laurel plugins

Usage:

```
laurel plugins [--json] <subcommand...>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<subcommand...>` | required (variadic) | `list` (show installed plugins; currently always empty) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `-j, --json` | boolean | `LAUREL_PLUGINS_JSON` | Emit the plugin list as JSON |

Examples:

```
laurel plugins list
```

### `laurel import-ghost`

Convert a Ghost JSON export into Markdown content

Usage:

```
laurel import-ghost [--on-conflict <skip|overwrite|rename>] [--assets <dir>] [--output <dir>] [--download-images] [--max-image-size <size>] [--no-download-settings-images] [--source-url <url>] [--dry-run] [--include-drafts] [--include-pages] [--only-tags <slugs>] [--since <date>] [--max-size <size>] [--max-post-html-size <size>] [--keep-code-injection] [--keep-html] [--json] <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<file>` | required | Path to a Ghost export: a JSON file (.json), an unzipped folder containing one or more JSON exports, the .zip archive itself, or - to read JSON from stdin. The file extension is optional; format is sniffed by magic bytes (PK\x03\x04 → zip, leading "{" / "[" → json) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_IMPORT_GHOST_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--assets <dir>` | string | `LAUREL_IMPORT_GHOST_ASSETS` | Path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/ |
| `-o, --output <dir>` | string | `LAUREL_IMPORT_GHOST_OUTPUT` | Write imported Markdown, assets, and redirect review files under this directory instead of the project content/ and migration/ directories |
| `--download-images` | boolean | `LAUREL_IMPORT_GHOST_DOWNLOAD_IMAGES` | Download Ghost content image/media URLs into content/images/ and rewrite references to local paths; third-party service URLs stay external |
| `--max-image-size <size>` | string | `LAUREL_IMPORT_GHOST_MAX_IMAGE_SIZE` | Per-image size cap (e.g. 10MB, 1GB, or raw bytes) when --download-images is set; over-cap images are warned and left as remote URLs. Defaults to 10MB. Use 0 to disable. |
| `--no-download-settings-images` | boolean | `LAUREL_IMPORT_GHOST_NO_DOWNLOAD_SETTINGS_IMAGES` | With --download-images, skip Ghost settings-level images (icon, logo, cover_image, og_image, twitter_image). By default they are downloaded too so favicon and og:image work after a fresh build; needs --source-url to resolve site-relative paths. |
| `--source-url <url>` | string | `LAUREL_IMPORT_GHOST_SOURCE_URL` | Absolute URL of the source Ghost site (e.g. https://oldblog.com); rewrites in-body links that point at this host to site-relative paths |
| `--dry-run` | boolean | `LAUREL_IMPORT_GHOST_DRY_RUN` | Parse the export and print a summary of what would land (posts, drafts, empty bodies, conflicts, assets) without writing files or downloading images |
| `--include-drafts` | boolean | `LAUREL_IMPORT_GHOST_INCLUDE_DRAFTS` | When --only-tags or --since is set, include draft posts/pages too. Full imports already include drafts by default for backwards compatibility |
| `--include-pages` | boolean | `LAUREL_IMPORT_GHOST_INCLUDE_PAGES` | When --only-tags or --since is set, include pages too. Full imports already include pages by default for backwards compatibility |
| `--only-tags <slugs>` | string | `LAUREL_IMPORT_GHOST_ONLY_TAGS` | Only import posts tagged with one of these comma-separated tag slugs/names (e.g. news,blog). Tags are slug-normalized before matching |
| `--since <date>` | string | `LAUREL_IMPORT_GHOST_SINCE` | Only import posts/pages whose published_at (or created_at fallback) is on or after this date (e.g. 2024-01-01) |
| `--max-size <size>` | string | `LAUREL_IMPORT_GHOST_MAX_SIZE` | Maximum JSON export size accepted before refusing to parse (e.g. 256MB, 1GB, or raw bytes). Defaults to 256MB; guards against multi-GB exports OOM-ing the host. Use 0 to disable the check. |
| `--max-post-html-size <size>` | string | `LAUREL_IMPORT_GHOST_MAX_POST_HTML_SIZE` | Per-post rendered HTML size cap before Turndown conversion (e.g. 5MB, 20MB, or raw bytes). Defaults to 5MB; over-cap posts are warned and imported with empty Markdown bodies. Use 0 to disable. |
| `--keep-code-injection` | boolean | `LAUREL_IMPORT_GHOST_KEEP_CODE_INJECTION` | Preserve codeinjection_head / codeinjection_foot from the Ghost export verbatim. Off by default because exports from sites you no longer control can smuggle attacker scripts into {{ghost_head}} / {{ghost_foot}}; only enable when you trust the source. |
| `--keep-html` | boolean | `LAUREL_IMPORT_GHOST_KEEP_HTML` | Preserve each post/page rendered Ghost HTML body next to its imported Markdown as a sibling <slug>.md.html file. |
| `-j, --json` | boolean | `LAUREL_IMPORT_GHOST_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
laurel import-ghost ghost-export.json
laurel import-ghost ghost-export-folder       # imports all export*.json files in stable order
laurel import-ghost - < ghost-export.json   # read JSON from stdin
laurel import-ghost ghost-export.zip            # zip archive (auto-detected)
laurel import-ghost ghost-export --dry-run      # extension-less, magic-bytes sniff
laurel import-ghost export.json --output review-import
laurel import-ghost export.json --only-tags news,blog --since 2024-01-01
laurel import-ghost export.json --only-tags news --include-drafts --include-pages
laurel import-ghost export.json --download-images --max-image-size 5MB
laurel import-ghost export.json --on-conflict overwrite
```

### `laurel import-wordpress`

Convert a WordPress WXR XML export into Markdown content

Usage:

```
laurel import-wordpress [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <file>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<file>` | required | Path to a WordPress WXR XML export (Tools → Export in wp-admin produces this) |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_IMPORT_WORDPRESS_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `LAUREL_IMPORT_WORDPRESS_DRY_RUN` | Parse the export and print a summary of what would land (posts, drafts, type/status-filtered items, empty bodies, conflicts) without writing files |
| `-j, --json` | boolean | `LAUREL_IMPORT_WORDPRESS_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
laurel import-wordpress wordpress.xml
laurel import-wordpress wordpress.xml --dry-run
laurel import-wordpress wordpress.xml --on-conflict rename
```

### `laurel import-hugo`

Convert Hugo Markdown posts into Laurel content

Usage:

```
laurel import-hugo [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <dir>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<dir>` | required | Path to a Hugo project root. Laurel scans content/posts/, content/post/, content/blog/, then content/. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_IMPORT_HUGO_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `LAUREL_IMPORT_HUGO_DRY_RUN` | Scan Markdown and print a summary of what would land, including redirects from aliases, without writing files |
| `-j, --json` | boolean | `LAUREL_IMPORT_HUGO_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
laurel import-hugo ../old-hugo-site
laurel import-hugo ../old-hugo-site --dry-run
laurel import-hugo ../old-hugo-site --on-conflict rename
```

### `laurel import-jekyll`

Convert Jekyll Markdown posts into Laurel content

Usage:

```
laurel import-jekyll [--on-conflict <skip|overwrite|rename>] [--dry-run] [--json] <dir>
```

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `<dir>` | required | Path to a Jekyll project root. Laurel scans _posts/. |

Options:

| Flag | Type | Env var | Description |
| --- | --- | --- | --- |
| `--on-conflict <skip\|overwrite\|rename>` | string | `LAUREL_IMPORT_JEKYLL_ON_CONFLICT` | How to handle existing files when slugs collide: skip (default), overwrite, or rename |
| `--dry-run` | boolean | `LAUREL_IMPORT_JEKYLL_DRY_RUN` | Scan Markdown and print a summary of what would land, including redirects from aliases, without writing files |
| `-j, --json` | boolean | `LAUREL_IMPORT_JEKYLL_JSON` | Emit the import summary as JSON on stdout for CI consumption |

Examples:

```
laurel import-jekyll ../old-jekyll-site
laurel import-jekyll ../old-jekyll-site --dry-run
laurel import-jekyll ../old-jekyll-site --on-conflict rename
```
