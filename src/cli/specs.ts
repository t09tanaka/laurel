import type { CommandSpec } from './parse.ts';

export const BUILD_SPEC: CommandSpec = {
  name: 'build',
  summary: 'Build the site into the configured output directory',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    output: {
      type: 'string',
      short: 'o',
      description:
        'Override build.output_dir from the config (relative path inside the project root)',
      placeholder: '<dir>',
    },
    'base-path': {
      type: 'string',
      description:
        'Override build.base_path from the config (e.g. /preview/ for PR previews or /repo/ for GitHub Pages)',
      placeholder: '<path>',
    },
    'base-url': {
      type: 'string',
      description:
        'Override site.url from the config with an absolute host (e.g. https://pr-42.example.com) so canonical, OG, RSS, and sitemap URLs target preview deploys (Netlify/Vercel/Cloudflare PR URL). Distinct from --base-path, which prefixes the path on a host',
      placeholder: '<url>',
    },
    strict: {
      type: 'boolean',
      description: 'Exit with non-zero status if any warnings are emitted',
    },
    profile: {
      type: 'boolean',
      description:
        'Write dist/.nectar/profile.json with per-phase timing + bytes_emitted (and per-route render durations) for diagnosing slow builds',
    },
    'no-atomic': {
      type: 'boolean',
      description:
        'Disable atomic staging: write directly into build.output_dir instead of a sibling temp dir. Faster on slow filesystems but a mid-build failure leaves a half-written output and skips .nectarignore preservation; intended as an escape hatch for sandboxed CI runners where the rename-into-place step is restricted',
    },
    concurrency: {
      type: 'string',
      description:
        'Cap on how many routes render in parallel (positive integer). Defaults to availableParallelism() (CPU count). Lower it on memory-constrained CI runners; raise it cautiously — the render path is CPU-bound on the single JS thread so values above CPU count rarely help',
      placeholder: '<n>',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Plan routes, load templates, and render every route into memory without writing anything to disk (no staging dir, no asset copies, no manifest, no sitemap/RSS/etc.). Prints the same summary line as a real build; pair with --verbose to also print a per-route table (URL, template, bytes, output path)',
    },
    'include-drafts': {
      type: 'boolean',
      description:
        'Include posts and pages with `status: draft` in the build. Default is to exclude them so a forgotten WIP cannot accidentally ship. Emits a "Building with drafts" warning so the looser policy is visible in CI logs. NECTAR_DRAFTS=1 is honoured as a shorter env-var alias alongside the standard NECTAR_BUILD_INCLUDE_DRAFTS',
    },
    force: {
      type: 'boolean',
      description:
        'Ignore the previous build manifest (.nectar-manifest.json in the output dir) and re-render every route from scratch. Default behaviour reuses unchanged route HTML when the per-route hash (config + site + theme + template + route data) matches the last successful build; use --force as an escape hatch when the incremental cache appears stale or corrupted',
    },
    watch: {
      type: 'boolean',
      description:
        'After the initial build, keep the process alive and rebuild on changes to content/, theme/, and nectar.toml. Uses fs.watch with a 100ms debounce; no HTTP server (pair with `nectar serve` or an external static host). Errors in follow-up builds are logged but do not exit; Ctrl-C / SIGTERM stops the loop',
    },
  },
  positionals: [],
};

export const NEW_SPEC: CommandSpec = {
  name: 'new',
  summary: 'Scaffold a new post, page, tag, or author',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite the destination file if it already exists',
    },
    slug: {
      type: 'string',
      description:
        'Use this slug instead of one derived from the title (post/page only; for tag/author the positional already is the slug)',
      placeholder: '<slug>',
    },
    draft: {
      type: 'boolean',
      description:
        'Set frontmatter status to "draft" so the file is excluded from builds until promoted (post/page only)',
    },
    date: {
      type: 'string',
      description:
        'Override the published date with an ISO-8601 timestamp instead of the current time (post only)',
      placeholder: '<iso>',
    },
    tags: {
      type: 'string',
      description: 'Comma-separated list of tag slugs to seed in frontmatter (post only)',
      placeholder: '<a,b,c>',
    },
    author: {
      type: 'string',
      description: 'Author slug to seed in frontmatter (post only)',
      placeholder: '<slug>',
    },
    open: {
      type: 'boolean',
      description:
        'Open the created file in $EDITOR after writing it (warns and skips when $EDITOR is unset)',
    },
  },
  positionals: [
    { name: 'kind', description: 'post, page, tag, or author', required: true },
    {
      name: 'title',
      description:
        'Title (post/page) or slug (tag/author); variadic so quoting is optional for multi-word titles',
      required: true,
      variadic: true,
    },
  ],
};

export const DEV_SPEC: CommandSpec = {
  name: 'dev',
  summary:
    'Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    port: {
      type: 'string',
      description:
        'Port to listen on (0..65535 integer; defaults to 4321; pass 0 to let the kernel pick a free port for CI/smoke tests)',
      placeholder: '<n>',
    },
    host: {
      type: 'string',
      description: 'Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN)',
      placeholder: '<host>',
    },
  },
  positionals: [],
};

export const SERVE_SPEC: CommandSpec = {
  name: 'serve',
  summary: 'Serve the built site locally',
  options: {
    port: {
      type: 'string',
      description: 'Port to listen on (1..65535 integer; defaults to 4321)',
      placeholder: '<n>',
    },
    host: {
      type: 'string',
      description: 'Hostname to bind to (defaults to localhost; pass 0.0.0.0 to expose on the LAN)',
      placeholder: '<host>',
    },
    'no-watch': {
      type: 'boolean',
      description:
        'Disable the default rebuild-on-change loop; serve the existing dist/ as a static snapshot',
    },
    build: {
      type: 'boolean',
      short: 'b',
      description:
        'Run a full build before starting the server, regardless of whether dist/ already exists',
    },
  },
  positionals: [],
};

export const CHECK_SPEC: CommandSpec = {
  name: 'check',
  summary: 'Validate config, theme, and content',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    strict: {
      type: 'boolean',
      description: 'Exit with non-zero status if any warnings were emitted during the check',
    },
    'check-links': {
      type: 'boolean',
      description:
        'Scan every post/page body for relative `[text](./foo.md)` cross-links and relative image references; warn if any do not resolve to a known post/page or an existing file. Opt-in because it re-reads every body during check',
    },
    'check-external': {
      type: 'boolean',
      description:
        'Probe each external http(s) URL in navigation (and post/page bodies when --check-links is also set) with a HEAD request; warn on non-2xx, timeout, or network failure. Opt-in because it hits the network and is slow; per-URL timeout defaults to 5s',
    },
  },
  positionals: [],
};

export const IMPORT_GHOST_SPEC: CommandSpec = {
  name: 'import-ghost',
  summary: 'Convert a Ghost JSON export into Markdown content',
  options: {
    'on-conflict': {
      type: 'string',
      description:
        'How to handle existing files when slugs collide: skip (default), overwrite, or rename',
      placeholder: '<skip|overwrite|rename>',
    },
    assets: {
      type: 'string',
      description:
        "Path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/",
      placeholder: '<dir>',
    },
    'download-images': {
      type: 'boolean',
      description:
        'Download remote image URLs (Unsplash, Ghost CDN, …) into content/images/ and rewrite references to local paths',
    },
    'max-image-size': {
      type: 'string',
      description:
        'Per-image size cap (e.g. 10MB, 1GB, or raw bytes) when --download-images is set; over-cap images are warned and left as remote URLs. Defaults to 10MB. Use 0 to disable.',
      placeholder: '<size>',
    },
    'source-url': {
      type: 'string',
      description:
        'Absolute URL of the source Ghost site (e.g. https://oldblog.com); rewrites in-body links that point at this host to site-relative paths',
      placeholder: '<url>',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Parse the export and print a summary of what would land (posts, drafts, empty bodies, conflicts, assets) without writing files or downloading images',
    },
    'max-size': {
      type: 'string',
      description:
        'Maximum JSON export size accepted before refusing to parse (e.g. 256MB, 1GB, or raw bytes). Defaults to 256MB; guards against multi-GB exports OOM-ing the host. Use 0 to disable the check.',
      placeholder: '<size>',
    },
    'keep-code-injection': {
      type: 'boolean',
      description:
        'Preserve codeinjection_head / codeinjection_foot from the Ghost export verbatim. Off by default because exports from sites you no longer control can smuggle attacker scripts into {{ghost_head}} / {{ghost_foot}}; only enable when you trust the source.',
    },
  },
  positionals: [
    {
      name: 'file',
      description:
        'Path to a Ghost export: the JSON file, an unzipped folder, or the .zip archive itself',
      required: true,
    },
  ],
};

export const IMPORT_WORDPRESS_SPEC: CommandSpec = {
  name: 'import-wordpress',
  summary: 'Convert a WordPress WXR XML export into Markdown content',
  options: {
    'on-conflict': {
      type: 'string',
      description:
        'How to handle existing files when slugs collide: skip (default), overwrite, or rename',
      placeholder: '<skip|overwrite|rename>',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Parse the export and print a summary of what would land (posts, drafts, type/status-filtered items, empty bodies, conflicts) without writing files',
    },
  },
  positionals: [
    {
      name: 'file',
      description: 'Path to a WordPress WXR XML export (Tools → Export in wp-admin produces this)',
      required: true,
    },
  ],
};

export const INIT_SPEC: CommandSpec = {
  name: 'init',
  summary: 'Scaffold a new Nectar project in the current (or given) directory',
  options: {
    yes: {
      type: 'boolean',
      short: 'y',
      description: 'Skip prompts and use defaults (non-interactive)',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite existing files in the target directory',
    },
    dir: {
      type: 'string',
      description: 'Target directory to scaffold into (defaults to .)',
      placeholder: '<path>',
    },
  },
  positionals: [],
};

export const DOCTOR_SPEC: CommandSpec = {
  name: 'doctor',
  summary: 'Run health checks on the project (bun, config, theme, content, network)',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description: 'Emit results as JSON (for CI consumption)',
    },
    'no-network': {
      type: 'boolean',
      description: 'Skip the network reachability check',
    },
  },
  positionals: [],
};

export const CLEAN_SPEC: CommandSpec = {
  name: 'clean',
  summary: 'Remove dist/ and .nectar-cache build artifacts',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    yes: {
      type: 'boolean',
      short: 'y',
      description: 'Skip the confirmation prompt and delete immediately (non-interactive use)',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Print the paths that would be removed without actually deleting them. Implies non-interactive.',
    },
    keep: {
      type: 'string',
      description:
        'Path (relative to cwd) to preserve inside the targets. Repeat the flag is not supported; pass a comma-separated list (e.g. "dist/.well-known,dist/uploads") to keep multiple entries',
      placeholder: '<path[,path...]>',
    },
    json: {
      type: 'boolean',
      description: 'Emit the deletion summary as JSON (paths, kept, bytes) for CI consumption',
    },
  },
  positionals: [],
};

export const COMPLETIONS_SPEC: CommandSpec = {
  name: 'completions',
  summary: 'Print a shell completion script for the given shell',
  options: {},
  positionals: [
    {
      name: 'shell',
      description: 'Target shell: bash, zsh, fish, or powershell',
      required: true,
    },
  ],
};

export const CONTENT_SPEC: CommandSpec = {
  name: 'content',
  summary: 'Inspect or modify content in the project (posts, pages)',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    kind: {
      type: 'string',
      description:
        'For `list`: filter by content kind (posts or pages). For `rename`: which kind to look up the slug under (defaults to posts; pass `pages` to rename a page slug instead)',
      placeholder: '<posts|pages>',
    },
    draft: {
      type: 'boolean',
      description:
        'Include draft posts/pages in the listing (default: only published; `list` only)',
    },
    tag: {
      type: 'string',
      description: 'Show only entries that have the given tag slug (`list` only)',
      placeholder: '<slug>',
    },
    author: {
      type: 'string',
      description: 'Show only entries that have the given author slug (`list` only)',
      placeholder: '<slug>',
    },
    json: {
      type: 'boolean',
      description: 'Emit results as JSON for CI consumption (both `list` and `rename`)',
    },
    redirect: {
      type: 'boolean',
      description:
        'On `rename`: append a `<old-url>  <new-url>  301` entry to `redirects.yaml` at the project root so the old URL keeps working when emitted through the redirects component',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`list` (show posts/pages) or `rename <old-slug> <new-slug>` (move a post/page file + rewrite its `slug` frontmatter)',
      required: true,
      variadic: true,
    },
  ],
};

export const INFO_SPEC: CommandSpec = {
  name: 'info',
  summary: 'Print Nectar, Bun, and project environment information',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description: 'Emit the report as JSON for CI consumption',
    },
  },
  positionals: [],
};

export const TAGS_SPEC: CommandSpec = {
  name: 'tags',
  summary: 'Inspect or modify tags in the project',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    orphaned: {
      type: 'boolean',
      description:
        'Show only tags that are defined under content/tags/ but referenced by zero posts (`list` only)',
    },
    unused: {
      type: 'boolean',
      description: 'Alias for --orphaned (`list` only)',
    },
    json: {
      type: 'boolean',
      description: 'Emit results as JSON for CI consumption (both `list` and `rename`)',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'On `rename`: scan and report the files that would change without writing anything',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`list` (show tags) or `rename <old-slug> <new-slug>` (rewrite every post/page frontmatter reference + move `content/tags/<old>.md` to `<new>.md` atomically)',
      required: true,
      variadic: true,
    },
  ],
};

export const CONFIG_SPEC: CommandSpec = {
  name: 'config',
  summary: 'Inspect the loaded nectar.toml config',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the value as JSON. For `get`: pretty-printed JSON of the value at the dotted path. For `path`: a `{ "config_path": "..." }` envelope so CI consumers can branch on `null` for "no config".',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`get <dotted.key>` (print the value at a dotted path, e.g. `site.url` or `build.base_path`) or `path` (print the absolute path of the loaded config file, or nothing in plain mode / `null` in --json mode when no config was found)',
      required: true,
      variadic: true,
    },
  ],
};

export const LINT_SPEC: CommandSpec = {
  name: 'lint',
  summary:
    'Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter)',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description:
        'Emit findings as JSON ({ count, findings: [{ rule, severity, file, message }] }) for CI consumption',
    },
    strict: {
      type: 'boolean',
      description:
        'Exit with non-zero status if any warning-level findings were emitted (errors always exit non-zero)',
    },
    'max-title-length': {
      type: 'string',
      description:
        'Override the max title length before a warning is emitted (default: 70 characters; Google SERP cut-off rule of thumb)',
      placeholder: '<n>',
    },
  },
  positionals: [],
};

export const MIGRATE_SPEC: CommandSpec = {
  name: 'migrate',
  summary:
    'Convert content from another platform into Nectar Markdown. `ghost <file>`, `wordpress <wxr.xml>`, `hugo <dir>`, `jekyll <dir>`, or `eleventy <dir>`',
  options: {
    'on-conflict': {
      type: 'string',
      description:
        'How to handle existing files when slugs collide: skip (default), overwrite, or rename (ghost/wordpress only)',
      placeholder: '<skip|overwrite|rename>',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Parse the source and print a summary of what would land without writing files (ghost/wordpress only; hugo/jekyll/eleventy print a copy plan)',
    },
    assets: {
      type: 'string',
      description:
        "ghost only: path to a Ghost content/ dir holding images/, files/, media/ subdirs; copied into the project's content/",
      placeholder: '<dir>',
    },
    'download-images': {
      type: 'boolean',
      description:
        'ghost only: download remote image URLs into content/images/ and rewrite references to local paths',
    },
    'max-image-size': {
      type: 'string',
      description:
        'ghost only: per-image size cap when --download-images is set (e.g. 10MB; default 10MB; 0 disables)',
      placeholder: '<size>',
    },
    'source-url': {
      type: 'string',
      description:
        'ghost only: absolute URL of the source Ghost site; rewrites in-body links pointing at this host to site-relative paths',
      placeholder: '<url>',
    },
    'max-size': {
      type: 'string',
      description:
        'ghost only: max JSON export size before refusing to parse (e.g. 256MB; default 256MB; 0 disables)',
      placeholder: '<size>',
    },
    'keep-code-injection': {
      type: 'boolean',
      description:
        'ghost only: preserve codeinjection_head / codeinjection_foot verbatim. Off by default; only enable when you trust the source.',
    },
  },
  positionals: [
    {
      name: 'source-and-args',
      description:
        '`<source> <path>` where source is one of `ghost`, `wordpress`, `hugo`, `jekyll`, `eleventy`',
      required: true,
      variadic: true,
    },
  ],
};

export const THEME_SPEC: CommandSpec = {
  name: 'theme',
  summary:
    'Manage themes in the project. `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    from: {
      type: 'string',
      description:
        '`new` only: copy from an existing theme directory under `themes/` instead of writing the minimal default scaffold',
      placeholder: '<theme-name>',
    },
    output: {
      type: 'string',
      short: 'o',
      description:
        '`zip` only: output path for the archive (defaults to `<name>-<version>.zip` in the current directory)',
      placeholder: '<path>',
    },
    force: {
      type: 'boolean',
      description:
        'Overwrite the destination directory (`new`) or archive (`zip`) if it already exists',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`new <name>` (scaffold themes/<name>/) or `zip` (archive the active theme into a gscan-compatible .zip)',
      required: true,
      variadic: true,
    },
  ],
};

export const OPEN_SPEC: CommandSpec = {
  name: 'open',
  summary:
    'Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    kind: {
      type: 'string',
      description:
        'Restrict the lookup to `posts` or `pages` (default: search both). When a slug exists under both kinds the explicit hint avoids the ambiguity error',
      placeholder: '<posts|pages>',
    },
  },
  positionals: [
    {
      name: 'slug',
      description: 'Slug of the post or page to open (e.g. `hello-world`)',
      required: false,
    },
  ],
};

export const COMMAND_SPECS: Record<string, CommandSpec> = {
  init: INIT_SPEC,
  build: BUILD_SPEC,
  new: NEW_SPEC,
  open: OPEN_SPEC,
  dev: DEV_SPEC,
  serve: SERVE_SPEC,
  check: CHECK_SPEC,
  doctor: DOCTOR_SPEC,
  clean: CLEAN_SPEC,
  completions: COMPLETIONS_SPEC,
  config: CONFIG_SPEC,
  content: CONTENT_SPEC,
  info: INFO_SPEC,
  lint: LINT_SPEC,
  tags: TAGS_SPEC,
  theme: THEME_SPEC,
  migrate: MIGRATE_SPEC,
  'import-ghost': IMPORT_GHOST_SPEC,
  'import-wordpress': IMPORT_WORDPRESS_SPEC,
};

export const COMMAND_NAMES = Object.keys(COMMAND_SPECS);
