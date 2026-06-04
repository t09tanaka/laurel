// Public entry point for plugin authors. Re-exports the documented types so
// downstream code can write:
//
//   import type { Plugin, BuildContext } from 'laurel/plugin';
//
// without reaching into deep internal paths. Anything not re-exported here is
// internal and may change without notice.

export type {
  BuildContext,
  MarkdownTransformContext,
  LaurelHelper,
  LaurelPlugin,
  Plugin,
  PluginFactory,
  PluginModuleShape,
  PluginRoute,
} from './types.ts';

export { loadPlugins } from './loader.ts';
export type { LoadPluginsOptions, LoadedPluginSet } from './loader.ts';
