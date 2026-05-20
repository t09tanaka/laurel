import type { CommandSpec } from './parse.ts';

export const BUILD_SPEC: CommandSpec = {
  name: 'build',
  summary: 'Build the site into the configured output directory',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
        'Write dist/.nectar-build-stats.json with phase timings and per-route render durations for diagnosing slow builds',
    },
    atomic: {
      type: 'boolean',
      default: true,
      description:
        'Use atomic staging: write into a sibling temp dir before renaming into build.output_dir',
      negatedDescription:
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
    cache: {
      type: 'boolean',
      default: true,
      description:
        'Use the previous build manifest to skip unchanged route HTML. Enabled by default; pass --no-cache to force every route to render without consulting the incremental cache',
      negatedDescription: 'Force every route to render without consulting the incremental cache',
    },
    progress: {
      type: 'boolean',
      default: true,
      description:
        'Print human-readable build progress and summary lines to stdout. Enabled by default; pass --no-progress to keep warnings/errors on stderr while suppressing build progress output. This keeps warnings/errors visible when running `nectar build > build.log`',
      negatedDescription:
        'Suppress human-readable build progress and summary lines on stdout while keeping warnings/errors on stderr',
    },
    'copy-content-assets': {
      type: 'boolean',
      default: true,
      description:
        'Copy files from content.assets_dir into the output. Enabled by default from config; pass --no-copy-content-assets to skip that copy for this build',
      negatedDescription: 'Skip copying files from content.assets_dir into the output',
    },
    watch: {
      type: 'boolean',
      description:
        'After the initial build, keep the process alive and rebuild on changes to content/, theme/, and nectar.toml. Uses fs.watch with a 100ms debounce; no HTTP server (pair with `nectar serve` or an external static host). Errors in follow-up builds are logged but do not exit; Ctrl-C / SIGTERM stops the loop',
    },
    'emit-content-api': {
      type: 'boolean',
      default: true,
      description:
        'Override `[components.content_api].enabled` for this build: passing the flag forces the Ghost Content API JSON shadows under `dist/content/` and `dist/ghost/api/content/` on regardless of the config. Without the flag and env var the config value (default `true`) is used',
      negatedDescription:
        'Force Ghost Content API JSON shadows off for this build without editing the config',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the build completion event as one final JSON line ({ event: "build.done", routeCount, assetCount, outputDir, warningCount, renderedCount, skippedCount, dryRun }) on stdout for CI consumption. Human progress is suppressed; warnings/errors still go to stderr so `nectar build --json > build.jsonl` does not hide failures',
    },
  },
  positionals: [],
  examples: [
    'nectar build                                 # one-shot build into dist/',
    'nectar build --strict                        # fail when the build emits any warnings',
    'nectar build --output dist-preview --base-path /preview/',
    'nectar build --dry-run --verbose             # plan routes without writing anything',
    'nectar build --watch                         # rebuild on content/theme/config changes',
    'nectar build --json                          # emit the summary as JSON for CI',
  ],
};

export const NEW_SPEC: CommandSpec = {
  name: 'new',
  summary: 'Scaffold a new post, page, tag, or author',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
      description: 'Tag slugs to seed in frontmatter (post only); repeat or comma-separate',
      placeholder: '<a,b,c>',
      repeatable: true,
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
    json: {
      type: 'boolean',
      description:
        'Emit the result (created path, slug, kind) as JSON on stdout instead of the human "Created ..." line',
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
  examples: [
    'nectar new post "Hello World"               # content/posts/hello-world.md',
    'nectar new post "Draft Idea" --draft        # status: draft so the build skips it',
    'nectar new post "Tagged" --tags news,tech --author jane',
    'nectar new tag releases                      # content/tags/releases.md',
    'nectar new author jane                       # content/authors/jane.md',
  ],
};

export const DEV_SPEC: CommandSpec = {
  name: 'dev',
  summary:
    'Run a development server: builds once, watches content/theme/config, rebuilds on change, and live-reloads the browser',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
    json: {
      type: 'boolean',
      description:
        'Switch logger output (status / rebuild events) to one JSON object per line for CI / log forwarders. Accepted globally; flag here just makes it visible in `--help`',
    },
  },
  positionals: [],
  examples: [
    'nectar dev                                   # http://localhost:4321 with live reload',
    'nectar dev --port 8080                       # pick a different port',
    'nectar dev --host 0.0.0.0                    # expose on the LAN (mobile testing)',
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
    watch: {
      type: 'boolean',
      default: true,
      description: 'Enable the default rebuild-on-change loop while serving dist/',
      negatedDescription:
        'Disable the default rebuild-on-change loop; serve dist/ as a static snapshot',
    },
    build: {
      type: 'boolean',
      short: 'b',
      description:
        'Run a full build before starting the server, regardless of whether dist/ already exists',
    },
    simulate: {
      type: 'string',
      description:
        'Simulate deploy-target redirects and headers from emitted artifacts while serving locally. Supported targets: netlify, cloudflare-pages, vercel',
      placeholder: '<target>',
    },
    json: {
      type: 'boolean',
      description:
        'Switch logger output (rebuild events / lifecycle) to one JSON object per line for CI / log forwarders',
    },
  },
  positionals: [],
  examples: [
    'nectar serve                                 # serve dist/ + rebuild on change',
    'nectar serve --no-watch                      # serve dist/ as a static snapshot',
    'nectar serve --simulate netlify --no-watch   # apply emitted _headers/_redirects locally',
    'nectar serve --build                         # build first, then serve',
    'nectar serve --port 8080 --host 0.0.0.0',
  ],
};

export const CHECK_SPEC: CommandSpec = {
  name: 'check',
  summary: 'Validate config, theme, and content',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
    'check-frontmatter': {
      type: 'boolean',
      description:
        'Walk content/posts/**/*.md and content/pages/**/*.md and validate each frontmatter block against the schema (required title, date format, status one of published/draft/scheduled, …). Off by default because it re-reads every file; pair with --strict in CI to fail on warnings',
    },
    'check-templates': {
      type: 'boolean',
      description:
        'Cross-check the active theme against the route plan: warn when a route would request a template name (post, page, tag, author, index, default) that does not exist in the theme. Stops a typo in a route layout from rendering through the default fallback unnoticed',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the check report as JSON ({ ok, errors: [...], warnings: [...] }) on stdout for CI consumption. Each entry includes file, line, message, and code',
    },
  },
  positionals: [],
  examples: [
    'nectar check                                 # config + theme + content validation',
    'nectar check --strict                        # fail on any warning (use in CI)',
    'nectar check --check-frontmatter --check-templates',
    'nectar check --check-links                   # also resolve relative markdown links',
    'nectar check --json | jq                     # machine-readable findings',
  ],
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
    output: {
      type: 'string',
      description:
        'Write imported Markdown, assets, and redirect review files under this directory instead of the project content/ and migration/ directories',
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
    'include-drafts': {
      type: 'boolean',
      description:
        'When --only-tags or --since is set, include draft posts/pages too. Full imports already include drafts by default for backwards compatibility',
    },
    'include-pages': {
      type: 'boolean',
      description:
        'When --only-tags or --since is set, include pages too. Full imports already include pages by default for backwards compatibility',
    },
    'only-tags': {
      type: 'string',
      description:
        'Only import posts tagged with one of these comma-separated tag slugs/names (e.g. news,blog). Tags are slug-normalized before matching',
      placeholder: '<slugs>',
    },
    since: {
      type: 'string',
      description:
        'Only import posts/pages whose published_at (or created_at fallback) is on or after this date (e.g. 2024-01-01)',
      placeholder: '<date>',
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
    'keep-html': {
      type: 'boolean',
      description:
        'Preserve each post/page rendered Ghost HTML body next to its imported Markdown as a sibling <slug>.md.html file.',
    },
    json: {
      type: 'boolean',
      description: 'Emit the import summary as JSON on stdout for CI consumption',
    },
  },
  positionals: [
    {
      name: 'file',
      description:
        'Path to a Ghost export: the JSON file (.json), an unzipped folder, or the .zip archive itself. The file extension is optional; format is sniffed by magic bytes (PK\\x03\\x04 → zip, leading "{" / "[" → json)',
      required: true,
    },
  ],
  examples: [
    'nectar import-ghost ghost-export.json',
    'nectar import-ghost ghost-export.zip            # zip archive (auto-detected)',
    'nectar import-ghost ghost-export --dry-run      # extension-less, magic-bytes sniff',
    'nectar import-ghost export.json --output review-import',
    'nectar import-ghost export.json --only-tags news,blog --since 2024-01-01',
    'nectar import-ghost export.json --only-tags news --include-drafts --include-pages',
    'nectar import-ghost export.json --download-images --max-image-size 5MB',
    'nectar import-ghost export.json --on-conflict overwrite',
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
    json: {
      type: 'boolean',
      description: 'Emit the import summary as JSON on stdout for CI consumption',
    },
  },
  positionals: [
    {
      name: 'file',
      description: 'Path to a WordPress WXR XML export (Tools → Export in wp-admin produces this)',
      required: true,
    },
  ],
  examples: [
    'nectar import-wordpress wordpress.xml',
    'nectar import-wordpress wordpress.xml --dry-run',
    'nectar import-wordpress wordpress.xml --on-conflict rename',
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
    json: {
      type: 'boolean',
      description:
        'Emit the scaffold summary (created paths) as JSON on stdout instead of the human "Scaffolded" log',
    },
  },
  positionals: [],
  examples: [
    'nectar init                                  # scaffold in the current dir (interactive)',
    'nectar init --yes                            # accept defaults; CI-friendly',
    'nectar init --dir my-blog --yes              # scaffold a new project folder',
  ],
};

export const DOCTOR_SPEC: CommandSpec = {
  name: 'doctor',
  summary: 'Run health checks on the project (bun, config, theme, content, network)',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description: 'Emit results as JSON (for CI consumption)',
    },
    network: {
      type: 'boolean',
      default: true,
      description: 'Run the network reachability check',
      negatedDescription: 'Skip the network reachability check',
    },
  },
  positionals: [],
  examples: [
    'nectar doctor                                # full project health check',
    'nectar doctor --no-network                   # skip the connectivity probe',
    'nectar doctor --json                         # machine-readable for CI',
  ],
};

export const DIAGNOSTICS_SPEC: CommandSpec = {
  name: 'diagnostics',
  summary: 'Create support-safe diagnostics bundles',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    output: {
      type: 'string',
      short: 'o',
      description:
        'Path for the .tar.gz bundle. Defaults to nectar-diagnostics-<timestamp>.tar.gz in the current directory',
      placeholder: '<file>',
    },
    'log-lines': {
      type: 'string',
      description:
        'Maximum number of lines to include from each known Nectar log file. Defaults to 200; use 0 to omit log text while still listing log candidates',
      placeholder: '<n>',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Print the archive path and entry list without writing a bundle. Useful for auditing what support artifacts would be collected',
    },
    list: {
      type: 'boolean',
      description: 'Alias for --dry-run: list planned bundle entries without writing the archive',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the bundle result as JSON ({ output, entries, bytes, dryRun }) for CI or support scripts',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description: '`bundle` (write a redacted diagnostics .tar.gz)',
      required: true,
    },
  ],
  examples: [
    'nectar diagnostics bundle',
    'nectar diagnostics bundle --output support/nectar-diagnostics.tar.gz',
    'nectar diagnostics bundle --dry-run',
    'nectar diagnostics bundle --log-lines 50 --json',
  ],
};

export const CLEAN_SPEC: CommandSpec = {
  name: 'clean',
  summary: 'Remove dist/ and .nectar-cache build artifacts',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
        'Path (relative to cwd) to preserve inside the targets. Repeat or comma-separate values (e.g. "dist/.well-known,dist/uploads") to keep multiple entries',
      placeholder: '<path[,path...]>',
      repeatable: true,
    },
    json: {
      type: 'boolean',
      description: 'Emit the deletion summary as JSON (paths, kept, bytes) for CI consumption',
    },
  },
  positionals: [],
  examples: [
    'nectar clean                                 # interactive; asks before deleting',
    'nectar clean --yes                           # non-interactive (CI/scripts)',
    'nectar clean --dry-run                       # show what would be removed',
    'nectar clean --keep dist/.well-known --yes   # preserve specific paths',
  ],
};

export const COMPLETIONS_SPEC: CommandSpec = {
  name: 'completions',
  summary: 'Print a shell completion script for the given shell',
  options: {
    json: {
      type: 'boolean',
      description:
        'No-op for `completions`; accepted so the global `--json` flag does not error here. The output is always shell-script text',
    },
  },
  positionals: [
    {
      name: 'shell',
      description: 'Target shell: bash, zsh, fish, or powershell',
      required: true,
    },
  ],
  examples: [
    'nectar completions bash >> ~/.bashrc',
    'nectar completions zsh > ~/.zsh/_nectar',
    'nectar completions fish > ~/.config/fish/completions/nectar.fish',
  ],
};

export const CONTENT_SPEC: CommandSpec = {
  name: 'content',
  summary: 'Inspect or modify content in the project (posts, pages)',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    kind: {
      type: 'string',
      description:
        'For `list`: filter by content kind (posts or pages). For `show`, `delete`, and `touch`: restrict slug lookup to one kind (default searches posts then pages). For `rename`: which kind to look up the slug under (defaults to posts; pass `pages` to rename a page slug instead)',
      placeholder: '<posts|pages>',
    },
    lines: {
      type: 'string',
      description: 'For `show`: number of body lines to print after the frontmatter (default: 20)',
      placeholder: '<n>',
    },
    frontmatter: {
      type: 'boolean',
      description: 'For `show`: print only the YAML frontmatter block, without body preview lines',
    },
    draft: {
      type: 'boolean',
      description:
        'Include draft posts/pages in the listing (default: only published; `list` only)',
    },
    tag: {
      type: 'string',
      description:
        'Show only entries that have any given tag slug (`list` only); repeat or comma-separate',
      placeholder: '<slug>',
      repeatable: true,
    },
    author: {
      type: 'string',
      description:
        'Show only entries that have any given author slug (`list` only); repeat or comma-separate',
      placeholder: '<slug>',
      repeatable: true,
    },
    json: {
      type: 'boolean',
      description:
        'Emit results as JSON for CI consumption (`list`, `show`, `rename`, `delete`, and `touch`)',
    },
    redirect: {
      type: 'boolean',
      description:
        'On `rename`: append a `<old-url>  <new-url>  301` entry to `redirects.yaml` at the project root so the old URL keeps working when emitted through the redirects component',
    },
    purge: {
      type: 'boolean',
      description:
        'On `delete`: permanently remove matching entries from `.nectar/trash/` only when they are at least 30 days old. Never removes current content files',
    },
    date: {
      type: 'string',
      description:
        'On `touch`: set `updated_at` to this ISO-8601 timestamp instead of the current time; `now` is also accepted',
      placeholder: '<iso|now>',
    },
    published: {
      type: 'boolean',
      description: 'On `touch`: update `published_at` to the same timestamp as `updated_at`',
    },
    'published-at': {
      type: 'string',
      description:
        'On `touch`: set `published_at` to this ISO-8601 timestamp (or `now`) while also updating `updated_at`',
      placeholder: '<iso|now>',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`list` (show posts/pages), `show <slug>` (print frontmatter + body preview), `rename <old-slug> <new-slug>` (move a post/page file + rewrite its `slug` frontmatter), `delete <slug>` (move content into `.nectar/trash/` with restore metadata), or `touch <slug>` (update date frontmatter)',
      required: true,
      variadic: true,
    },
  ],
  examples: [
    'nectar content list                          # posts + pages with status/date',
    'nectar content list --kind pages',
    'nectar content list --tag changelog --json',
    'nectar content show hello-world --lines 12',
    'nectar content show about --kind pages --frontmatter',
    'nectar content rename old-slug new-slug --redirect',
    'nectar content delete old-slug',
    'nectar content delete --purge old-slug',
    'nectar content touch hello-world --date 2026-01-02T03:04:05Z',
    'nectar content touch about --kind pages --published',
  ],
};

export const INFO_SPEC: CommandSpec = {
  name: 'info',
  summary: 'Print Nectar, Bun, and project environment information',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description: 'Emit the report as JSON for CI consumption',
    },
  },
  positionals: [],
  examples: [
    'nectar info                                  # human-readable summary',
    'nectar info --json                           # machine-readable; same payload',
    'nectar env                                   # alias for `nectar info`',
  ],
};

export const TAGS_SPEC: CommandSpec = {
  name: 'tags',
  summary: 'Inspect or modify tags in the project',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
      description: 'Emit results as JSON for CI consumption (`list`, `rename`, and `merge`)',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'On `rename`/`merge`: scan and report the files that would change without writing anything',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`list` (show tags), `rename <old-slug> <new-slug>`, or `merge <from> [from...] <into>` (rewrite post/page tag references and safely handle tag files)',
      required: true,
      variadic: true,
    },
  ],
  examples: [
    'nectar tags list                             # all tags + post counts',
    'nectar tags list --orphaned                  # tags defined but unused',
    'nectar tags rename old-tag new-tag',
    'nectar tags rename old new --dry-run         # preview files that would change',
    'nectar tags merge draft old canonical --dry-run',
  ],
};

export const AUTHORS_SPEC: CommandSpec = {
  name: 'authors',
  summary: 'Inspect authors in the project',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    orphaned: {
      type: 'boolean',
      description:
        'Show only authors that are defined under content/authors/ but referenced by zero posts (`list` only)',
    },
    json: {
      type: 'boolean',
      description: 'Emit results as JSON for CI consumption (`list` only)',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description: '`list` (show authors and post counts)',
      required: true,
      variadic: true,
    },
  ],
  examples: [
    'nectar authors list                          # all authors + post counts',
    'nectar authors list --orphaned               # authors defined but unused by posts',
    'nectar authors list --json                   # machine-readable author inventory',
  ],
};

export const CONFIG_SPEC: CommandSpec = {
  name: 'config',
  summary: 'Inspect or update the loaded Nectar config',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the value as JSON. For `print`: equivalent to `--format json`. For `validate`: emit `{ ok, errors }`. For `get`: pretty-printed JSON of the value at the dotted path. For `set` and `path`: a `{ "config_path": "..." }` envelope so CI consumers can branch on `null` for "no config".',
    },
    format: {
      type: 'string',
      description:
        'For `print`, choose the resolved config output format: `toml` (default) or `json`.',
      placeholder: '<json|toml>',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`print` (dump the fully resolved config after defaults, env overrides, and config layers), `validate` (load config only and exit 0/1), `get <dotted.key>` (print one value), `set <dotted.key> <value>` (write a string/number/bool), or `path` (print the absolute path of the loaded config file, or nothing in plain mode / `null` in --json mode when no config was found)',
      required: true,
      variadic: true,
    },
  ],
  examples: [
    'nectar config print                          # resolved config as TOML',
    'nectar config print --format json            # resolved config as JSON',
    'nectar config validate                       # config-only validation',
    'nectar config path                           # absolute path of the loaded toml',
    'nectar config get site.url',
    'nectar config set site.title "My Site"',
    'nectar config set components.rss.enabled false',
    'nectar config get build.base_path --json',
  ],
};

export const SCHEMA_SPEC: CommandSpec = {
  name: 'schema',
  summary: 'Print JSON Schema for Nectar config, frontmatter, or theme package.json',
  options: {},
  positionals: [
    {
      name: 'target',
      description: '`config`, `frontmatter`, or `theme`',
      required: true,
    },
  ],
  examples: [
    'nectar schema config > nectar.config.schema.json',
    'nectar schema frontmatter > nectar.frontmatter.schema.json',
    'nectar schema theme > nectar.theme.schema.json',
  ],
};

export const LINT_SPEC: CommandSpec = {
  name: 'lint',
  summary:
    'Run content-level lint checks (titles, alt text, broken local links, future dates, duplicate slugs, malformed frontmatter)',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
  examples: [
    'nectar lint                                  # warn-level summary table',
    'nectar lint --strict                         # exit non-zero on any warning',
    'nectar lint --json | jq                      # CI-friendly findings stream',
    'nectar lint --max-title-length 60',
  ],
};

export const FMT_SPEC: CommandSpec = {
  name: 'fmt',
  summary: 'Format content Markdown frontmatter in place',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    check: {
      type: 'boolean',
      description:
        'Check whether content Markdown frontmatter is already formatted without writing changes. Exits 1 when any file would change',
    },
  },
  positionals: [],
  examples: [
    'nectar fmt                                   # rewrite content frontmatter in place',
    'nectar fmt --check                           # CI check; exits 1 when formatting is needed',
  ],
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
    json: {
      type: 'boolean',
      description: 'Emit the migration summary as JSON on stdout for CI consumption',
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
  examples: [
    'nectar migrate ghost export.json',
    'nectar migrate ghost export.zip --on-conflict overwrite',
    'nectar migrate wordpress export.xml',
    'nectar migrate hugo ./old-hugo-site --dry-run',
    'nectar migrate jekyll ./old-jekyll-site',
  ],
};

export const THEME_SPEC: CommandSpec = {
  name: 'theme',
  summary:
    'Manage themes in the project. `list` shows available themes; `new <name>` scaffolds a minimal theme; `zip` packs the active theme into a `<name>-<version>.zip` archive; `lint <path>` checks a theme directory for required templates / helpers / partials',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
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
    json: {
      type: 'boolean',
      description: '`list` / `lint`: emit JSON instead of the default table',
    },
  },
  positionals: [
    {
      name: 'subcommand',
      description:
        '`list` (show themes under theme.dir), `new <name>` (scaffold themes/<name>/), `zip` (archive the active theme into a gscan-compatible .zip), or `lint <path>` (audit a theme directory)',
      required: true,
      variadic: true,
    },
  ],
  examples: [
    'nectar theme list                            # show themes under theme.dir',
    'nectar theme list --json                     # machine-readable theme list',
    'nectar theme new my-theme                    # scaffold themes/my-theme/',
    'nectar theme new my-fork --from source       # fork the active theme',
    'nectar theme zip                             # ship-ready zip in cwd',
    'nectar theme lint themes/my-theme            # audit before shipping',
    'nectar theme:lint themes/my-theme            # colon-style alias',
  ],
};

export const OPEN_SPEC: CommandSpec = {
  name: 'open',
  summary:
    'Open a post or page Markdown file in $EDITOR by slug. Tries content/posts/<slug>.md and content/pages/<slug>.md first, then falls back to scanning frontmatter for an exact `slug:` match',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    kind: {
      type: 'string',
      description:
        'Restrict the lookup to `posts` or `pages` (default: search both). When a slug exists under both kinds the explicit hint avoids the ambiguity error',
      placeholder: '<posts|pages>',
    },
    json: {
      type: 'boolean',
      description:
        'Emit the resolved file path (and slug/kind) as JSON on stdout instead of spawning $EDITOR. Useful for piping into other tooling',
    },
  },
  positionals: [
    {
      name: 'slug',
      description: 'Slug of the post or page to open (e.g. `hello-world`)',
      required: false,
    },
  ],
  examples: [
    'nectar open hello-world                      # opens content/posts/hello-world.md',
    'nectar open about --kind pages',
    'EDITOR=code nectar open hello-world          # respects $EDITOR',
  ],
};

export const DEPLOY_SPEC: CommandSpec = {
  name: 'deploy',
  summary:
    'Publish the built site to a hosting target. Targets: cloudflare, netlify, vercel, github-pages, s3, r2, rsync',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    build: {
      type: 'boolean',
      short: 'b',
      description:
        'Run `nectar build` before deploying so the publish step always uses fresh artifacts. Without this flag the command refuses to deploy when `dist/` is missing or has no `.nectar-manifest.json` (the build pre-flight); set it for one-shot deploys from CI without a separate build step',
    },
    'dry-run': {
      type: 'boolean',
      description:
        'Print the external command(s) the target would run (or the rsync source/destination, or the gh-pages branch push plan) without spawning anything. Used for CI smoke tests and so reviewers can audit the spawn payload before it is executed',
    },
    'project-name': {
      type: 'string',
      description:
        'cloudflare only: Cloudflare Pages project name forwarded to `wrangler pages deploy --project-name=<name>`. Overrides `[deploy.cloudflare].project_name`. Required for cloudflare when not set in config',
      placeholder: '<name>',
    },
    branch: {
      type: 'string',
      description:
        'cloudflare: branch label forwarded to `wrangler pages deploy --branch=<name>`. github-pages: branch to push the site to (defaults to `[deploy.github_pages].branch` or `gh-pages`)',
      placeholder: '<name>',
    },
    'site-id': {
      type: 'string',
      description:
        'netlify only: Netlify site id forwarded to `netlify deploy --site=<id>`. Overrides `[deploy.netlify].site_id`',
      placeholder: '<id>',
    },
    prod: {
      type: 'boolean',
      description:
        'netlify, vercel: explicitly pass `--prod`. Default `true` for both via config (`[deploy.<target>].prod`); pair with `--prod=false`-equivalent NECTAR_DEPLOY_PROD=0 env var when the CLI flag is unsuitable',
    },
    bucket: {
      type: 'string',
      description:
        's3 / r2: target bucket name. Forwarded to `aws s3 sync dist s3://<bucket>`. Overrides the matching `[deploy.s3].bucket` or `[deploy.r2].bucket` config entry',
      placeholder: '<name>',
    },
    region: {
      type: 'string',
      description:
        's3 only: AWS region forwarded as `--region <region>` to `aws s3 sync`. Overrides `[deploy.s3].region`',
      placeholder: '<region>',
    },
    endpoint: {
      type: 'string',
      description:
        'r2 only: R2 S3-compatible endpoint URL forwarded as `--endpoint-url <url>` to `aws s3 sync`. Overrides `[deploy.r2].endpoint`',
      placeholder: '<url>',
    },
    destination: {
      type: 'string',
      description:
        'rsync only: destination string (e.g. `user@host:/var/www/site/`). Overrides `[deploy.rsync].destination`',
      placeholder: '<user@host:path>',
    },
    remote: {
      type: 'string',
      description:
        'github-pages only: git remote forwarded to `git push <remote> <branch>` (defaults to `[deploy.github_pages].remote` or `origin`)',
      placeholder: '<name>',
    },
    json: {
      type: 'boolean',
      description: 'Emit the deploy plan / outcome as JSON on stdout for CI consumption',
    },
  },
  positionals: [
    {
      name: 'target',
      description:
        'Hosting target: `cloudflare`, `netlify`, `vercel`, `github-pages`, `s3`, `r2`, or `rsync`',
      required: true,
    },
  ],
  examples: [
    'nectar deploy cloudflare --project-name my-blog --build',
    'nectar deploy netlify --site-id abc123',
    'nectar deploy vercel --prod',
    'nectar deploy github-pages --branch gh-pages',
    'nectar deploy rsync --destination user@host:/var/www/site/',
    'nectar deploy s3 --bucket my-bucket --region us-east-1 --dry-run',
  ],
};

export const EXPORT_SPEC: CommandSpec = {
  name: 'export',
  summary:
    'Dump the loaded content as JSON or regenerate the RSS feed without running a full build',
  options: {
    config: {
      type: 'string',
      description: 'Config path(s); repeat or comma-separate to deep-merge in order',
      placeholder: '<path>',
    },
    output: {
      type: 'string',
      short: 'o',
      description:
        'Path to write the export to. Defaults to stdout. Parent directories are created as needed; existing files are overwritten',
      placeholder: '<path>',
    },
    pretty: {
      type: 'boolean',
      description:
        'Pretty-print JSON output with 2-space indentation (`json` and `ghost-json` only). Default emits compact JSON',
    },
    'include-drafts': {
      type: 'boolean',
      description:
        'Include posts and pages with `status: draft` in the export. Off by default so an unintended draft cannot leak through `nectar export`',
    },
    json: {
      type: 'boolean',
      description:
        'No-op here; `export` already emits its own format-specific payload (json/ghost-json/rss). Accepted so the global `--json` flag does not error',
    },
  },
  positionals: [
    {
      name: 'format',
      description:
        'Export format: `json` (Nectar content graph), `ghost-json` (Ghost backup-shaped {db: [{data: {posts, pages, tags, users, posts_tags, posts_authors}}]}), or `rss` (RSS 2.0 XML)',
      required: true,
    },
  ],
  examples: [
    'nectar export json > content.json',
    'nectar export json --pretty -o snapshot.json',
    'nectar export ghost-json -o ghost-backup.json',
    'nectar export rss -o feed.xml',
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
  diagnostics: DIAGNOSTICS_SPEC,
  clean: CLEAN_SPEC,
  completions: COMPLETIONS_SPEC,
  config: CONFIG_SPEC,
  schema: SCHEMA_SPEC,
  content: CONTENT_SPEC,
  info: INFO_SPEC,
  lint: LINT_SPEC,
  fmt: FMT_SPEC,
  tags: TAGS_SPEC,
  authors: AUTHORS_SPEC,
  theme: THEME_SPEC,
  migrate: MIGRATE_SPEC,
  deploy: DEPLOY_SPEC,
  export: EXPORT_SPEC,
  'import-ghost': IMPORT_GHOST_SPEC,
  'import-wordpress': IMPORT_WORDPRESS_SPEC,
};

export const COMMAND_NAMES = Object.keys(COMMAND_SPECS);
