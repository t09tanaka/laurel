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
    strict: {
      type: 'boolean',
      description: 'Exit with non-zero status if any warnings are emitted',
    },
  },
  positionals: [],
};

export const NEW_SPEC: CommandSpec = {
  name: 'new',
  summary: 'Scaffold a new post or page',
  options: {
    force: {
      type: 'boolean',
      description: 'Overwrite the destination file if it already exists',
    },
    slug: {
      type: 'string',
      description: 'Use this slug instead of one derived from the title',
      placeholder: '<slug>',
    },
  },
  positionals: [
    { name: 'kind', description: 'post or page', required: true },
    { name: 'title', description: 'Title of the post or page', required: true, variadic: true },
  ],
};

export const SERVE_SPEC: CommandSpec = {
  name: 'serve',
  summary: 'Serve the built site locally',
  options: {
    port: {
      type: 'string',
      description: 'Port to listen on (defaults to 4321)',
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

export const CHECK_SPEC: CommandSpec = {
  name: 'check',
  summary: 'Validate config, theme, and content',
  options: {
    config: {
      type: 'string',
      description: 'Path to nectar.toml (defaults to ./nectar.toml)',
      placeholder: '<path>',
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
  },
  positionals: [
    {
      name: 'file',
      description: 'Path to the Ghost export JSON file or to an unzipped Ghost export folder',
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

export const COMMAND_SPECS: Record<string, CommandSpec> = {
  init: INIT_SPEC,
  build: BUILD_SPEC,
  new: NEW_SPEC,
  serve: SERVE_SPEC,
  check: CHECK_SPEC,
  doctor: DOCTOR_SPEC,
  'import-ghost': IMPORT_GHOST_SPEC,
};

export const COMMAND_NAMES = Object.keys(COMMAND_SPECS);
