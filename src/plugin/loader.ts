import { readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '~/util/logger.ts';
import type { Plugin, PluginFactory, PluginModuleShape } from './types.ts';

export interface LoadPluginsOptions {
  // Project root. Relative plugin paths from config resolve against this dir.
  cwd: string;
  // Explicit plugin specs from `[plugins]` config. Each entry is either a
  // file path (`./plugins/my-plugin.ts`) resolved against `cwd`, a bare
  // module specifier resolvable by Bun/Node (`laurel-plugin-foo`), or an
  // already-instantiated `Plugin` object (used in tests).
  specs?: ReadonlyArray<string | Plugin>;
  // When true, scan `node_modules/` for packages named
  // `laurel-plugin-*` or `@scope/laurel-plugin-*` and auto-load them. Opt-in
  // because a one-time `bun install` of an unrelated package should not flip
  // a site into running new build-time code without an explicit config edit.
  autoDetect?: boolean;
}

export interface LoadedPluginSet {
  readonly plugins: readonly Plugin[];
  // Specs that failed to load, with their error. Surfaced so the build
  // pipeline can warn once per failure without the loader logging twice.
  readonly failures: ReadonlyArray<{ spec: string; error: Error }>;
}

// Discover and instantiate plugins. Failures are isolated: a broken plugin
// produces a warning and is skipped, so a single bad plugin never bricks an
// entire build. Returns the load order so the pipeline can invoke hooks in a
// deterministic sequence.
export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadedPluginSet> {
  const plugins: Plugin[] = [];
  const failures: Array<{ spec: string; error: Error }> = [];
  const seen = new Set<string>();

  const specs = options.specs ?? [];
  for (const spec of specs) {
    if (typeof spec !== 'string') {
      // Pre-instantiated plugin object — surface as-is. Useful for unit tests
      // and embedders that build plugins programmatically.
      if (!validatePluginShape(spec, 'inline')) continue;
      if (seen.has(spec.name)) {
        logger.warn(`plugin '${spec.name}' already registered; ignoring duplicate`);
        continue;
      }
      plugins.push(spec);
      seen.add(spec.name);
      continue;
    }
    try {
      const loaded = await loadPluginFromSpec(spec, options.cwd);
      if (!validatePluginShape(loaded, spec)) continue;
      if (seen.has(loaded.name)) {
        logger.warn(
          `plugin '${loaded.name}' already registered; ignoring duplicate from '${spec}'`,
        );
        continue;
      }
      plugins.push(loaded);
      seen.add(loaded.name);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn(`failed to load plugin '${spec}': ${error.message}`);
      failures.push({ spec, error });
    }
  }

  if (options.autoDetect) {
    const autoSpecs = await discoverAutoPlugins(options.cwd);
    for (const spec of autoSpecs) {
      if (specs.includes(spec)) continue;
      try {
        // Auto-detected specs are package names, not paths the consumer's
        // bundler/resolver registered. Resolve them via `node_modules/`
        // directly (reading package.json#main) so the loader works without
        // requiring the host project to expose them through its own resolver.
        const loaded = await loadAutoDetectedPlugin(spec, options.cwd);
        if (!validatePluginShape(loaded, spec)) continue;
        if (seen.has(loaded.name)) continue;
        plugins.push(loaded);
        seen.add(loaded.name);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn(`failed to auto-load plugin '${spec}': ${error.message}`);
        failures.push({ spec, error });
      }
    }
  }

  return { plugins, failures };
}

// Resolve and import a plugin spec into a concrete `Plugin` object. A spec
// starting with `.` / `..` / `/` (or a path containing a path separator) is
// resolved against `cwd` and imported via a file URL. Anything else is
// treated as a bare module specifier and handed to the runtime's loader
// (Bun resolves these through node_modules).
async function loadPluginFromSpec(spec: string, cwd: string): Promise<Plugin> {
  const isRelative = spec.startsWith('.') || spec.startsWith('/');
  let importPath: string;
  if (isRelative) {
    const abs = isAbsolute(spec) ? spec : resolve(cwd, spec);
    importPath = pathToFileURL(abs).href;
  } else {
    importPath = spec;
  }
  const mod = (await import(importPath)) as PluginModuleShape;
  return await materializePlugin(mod);
}

// Load an auto-detected plugin directly from `<cwd>/node_modules/<spec>/`.
// We resolve through the host project's node_modules rather than relying on
// the consumer's bundler so the autoDetect contract is honest: anything that
// lives under their `node_modules/laurel-plugin-*` works, full stop.
async function loadAutoDetectedPlugin(spec: string, cwd: string): Promise<Plugin> {
  const pkgRoot = join(cwd, 'node_modules', spec);
  const pkgJsonPath = join(pkgRoot, 'package.json');
  const pkgFile = Bun.file(pkgJsonPath);
  if (!(await pkgFile.exists())) {
    throw new Error(`package.json not found at ${pkgJsonPath}`);
  }
  const pkg = (await pkgFile.json()) as {
    main?: string;
    module?: string;
    exports?: unknown;
  };
  // Prefer `module` (ESM) > `main` > `index.js` fallback. We don't try to
  // honour the full `exports` field — that's reserved for plugins published
  // via the normal `[plugins]` list where the host project's resolver does
  // the work; auto-detect is a convenience for self-contained packages.
  const entry = pkg.module ?? pkg.main ?? 'index.js';
  const entryAbs = join(pkgRoot, entry);
  const importPath = pathToFileURL(entryAbs).href;
  const mod = (await import(importPath)) as PluginModuleShape;
  return await materializePlugin(mod);
}

// Reduce the various accepted module shapes (default export, named `plugin`
// export, factory function, plain object) to a single `Plugin` object.
async function materializePlugin(mod: PluginModuleShape): Promise<Plugin> {
  let candidate: Plugin | PluginFactory | undefined;
  if (mod && typeof mod === 'object') {
    if ('default' in mod && mod.default) candidate = mod.default;
    else if ('plugin' in mod && mod.plugin) candidate = mod.plugin;
    else if ('name' in mod && typeof (mod as Plugin).name === 'string') {
      // Module itself is the plugin object (`export const name = '...'` style).
      candidate = mod as Plugin;
    }
  }
  if (!candidate) {
    throw new Error('module does not export a Plugin (expected `default`, `plugin`, or `name`)');
  }
  if (typeof candidate === 'function') {
    return await candidate();
  }
  return candidate;
}

// Discover `laurel-plugin-*` and `@scope/laurel-plugin-*` packages in the
// project's `node_modules/`. Scoped scan is one directory level deep so we
// don't accidentally walk every dependency's nested node_modules.
async function discoverAutoPlugins(cwd: string): Promise<string[]> {
  const nodeModules = join(cwd, 'node_modules');
  const discovered: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(nodeModules);
  } catch {
    return discovered;
  }
  for (const entry of entries) {
    if (entry.startsWith('laurel-plugin-')) {
      discovered.push(entry);
      continue;
    }
    if (entry.startsWith('@')) {
      let scoped: string[];
      try {
        scoped = await readdir(join(nodeModules, entry));
      } catch {
        continue;
      }
      for (const inner of scoped) {
        if (inner.startsWith('laurel-plugin-')) {
          discovered.push(`${entry}/${inner}`);
        }
      }
    }
  }
  // Stable order so plugin invocation is deterministic across runs.
  discovered.sort();
  return discovered;
}

function validatePluginShape(value: unknown, spec: string): value is Plugin {
  if (!value || typeof value !== 'object') {
    logger.warn(`plugin from '${spec}' is not an object; skipping`);
    return false;
  }
  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string' || name.length === 0) {
    logger.warn(`plugin from '${spec}' is missing a string 'name'; skipping`);
    return false;
  }
  return true;
}
