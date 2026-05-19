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
  options: {},
  positionals: [{ name: 'file', description: 'Path to the Ghost export JSON', required: true }],
};

export const COMMAND_SPECS: Record<string, CommandSpec> = {
  build: BUILD_SPEC,
  new: NEW_SPEC,
  serve: SERVE_SPEC,
  check: CHECK_SPEC,
  'import-ghost': IMPORT_GHOST_SPEC,
};

export const COMMAND_NAMES = Object.keys(COMMAND_SPECS);
