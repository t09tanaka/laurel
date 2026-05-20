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
  summary: 'Inspect content in the project (posts, pages)',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    kind: {
      type: 'string',
      description: 'Filter by content kind: posts (default) or pages',
      placeholder: '<posts|pages>',
    },
    draft: {
      type: 'boolean',
      description: 'Include draft posts/pages in the listing (default: only published)',
    },
    tag: {
      type: 'string',
      description: 'Show only entries that have the given tag slug',
      placeholder: '<slug>',
    },
    author: {
      type: 'string',
      description: 'Show only entries that have the given author slug',
      placeholder: '<slug>',
    },
    json: {
      type: 'boolean',
      description: 'Emit the listing as JSON (one array of objects) for CI consumption',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description: 'Currently only `list` is supported',
      required: true,
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
  summary: 'Inspect tags in the project',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
    },
    orphaned: {
      type: 'boolean',
      description:
        'Show only tags that are defined under content/tags/ but referenced by zero posts',
    },
    unused: {
      type: 'boolean',
      description: 'Alias for --orphaned',
    },
    json: {
      type: 'boolean',
      description: 'Emit the listing as JSON (slug, name, post_count) for CI consumption',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description: 'Currently only `list` is supported',
      required: true,
    },
  ],
};

export const COMMAND_SPECS: Record<string, CommandSpec> = {
  init: INIT_SPEC,
  build: BUILD_SPEC,
  new: NEW_SPEC,
  serve: SERVE_SPEC,
  check: CHECK_SPEC,
  doctor: DOCTOR_SPEC,
  clean: CLEAN_SPEC,
  completions: COMPLETIONS_SPEC,
  content: CONTENT_SPEC,
  info: INFO_SPEC,
  tags: TAGS_SPEC,
  'import-ghost': IMPORT_GHOST_SPEC,
  'import-wordpress': IMPORT_WORDPRESS_SPEC,
};

export const COMMAND_NAMES = Object.keys(COMMAND_SPECS);
