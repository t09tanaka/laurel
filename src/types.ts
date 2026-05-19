// Public TypeScript types for Nectar plugin and theme authors. This module
// is the only documented entry point for downstream code; anything not
// re-exported here is internal and may change without notice.
//
// Import via the `nectar/types` package entry:
//   import type { NectarPlugin, BuildContext, Post } from 'nectar/types';

export type { NavigationItem, NectarConfig } from './config/schema.ts';

export type {
  Author,
  ContentGraph,
  Page,
  Post,
  SiteData,
  Tag,
} from './content/model.ts';

export type { BuildOptions, BuildSummary } from './build/pipeline.ts';

export type { NectarEngine } from './render/engine.ts';

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

export type { BuildContext, NectarHelper, NectarPlugin } from './plugin.ts';
