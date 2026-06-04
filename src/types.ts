// Public TypeScript types for Laurel plugin and theme authors. This module
// is the only documented entry point for downstream code; anything not
// re-exported here is internal and may change without notice.
//
// Import via the `laurel/types` package entry:
//   import type { LaurelPlugin, BuildContext, Post } from 'laurel/types';

export type { NavigationItem, LaurelConfig } from './config/schema.ts';

export type {
  Author,
  ContentGraph,
  Page,
  Post,
  SiteData,
  Tag,
} from './content/model.ts';

export type { BuildOptions, BuildSummary } from './build/pipeline.ts';

export type { LaurelEngine } from './render/engine.ts';

export type {
  PaginationInfo,
  RenderInputs,
  RouteContext,
  RouteKind,
} from './render/types.ts';

export type {
  ThemeAsset,
  ThemeBundle,
  ThemeCustomSettingDefinition,
  ThemeImageSize,
  ThemePackage,
} from './theme/types.ts';

export type {
  BuildContext,
  MarkdownTransformContext,
  LaurelHelper,
  LaurelPlugin,
  Plugin,
  PluginFactory,
  PluginRoute,
} from './plugin/types.ts';
