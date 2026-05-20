import { describe, expect, test } from 'bun:test';
import type {
  Author,
  BuildContext,
  BuildOptions,
  BuildSummary,
  ContentGraph,
  MarkdownTransformContext,
  NavigationItem,
  NectarConfig,
  NectarEngine,
  NectarHelper,
  NectarPlugin,
  Page,
  PaginationInfo,
  Plugin,
  PluginFactory,
  PluginRoute,
  Post,
  RenderInputs,
  RouteContext,
  RouteKind,
  SiteData,
  Tag,
  ThemeAsset,
  ThemeBundle,
  ThemeCustomSettingDefinition,
  ThemeImageSize,
  ThemePackage,
} from '~/types.ts';

// The barrel module re-exports types only; verify it loads without runtime
// exports leaking and that downstream code can compose against it.
describe('public types barrel', () => {
  test('module evaluates without runtime exports', async () => {
    const mod = (await import('~/types.ts')) as Record<string, unknown>;
    // type-only re-exports compile to an empty module
    const ownKeys = Object.keys(mod).filter((k) => k !== 'default');
    expect(ownKeys).toEqual([]);
  });

  test('NectarPlugin shape is usable', () => {
    const plugin: NectarPlugin = {
      name: 'example-plugin',
      setup(ctx: BuildContext) {
        expect(ctx.cwd).toBeDefined();
      },
    };
    expect(plugin.name).toBe('example-plugin');
  });

  test('helper signature accepts arbitrary args', () => {
    const helper: NectarHelper = function (this: unknown, ...args: unknown[]) {
      return args.length;
    };
    expect(helper.call(null, 1, 2, 3)).toBe(3);
  });

  // Compile-time only: referencing the imported names ensures the barrel
  // continues to export each documented symbol. The runtime assertion below
  // is irrelevant; failure would surface as a TypeScript error.
  test('all advertised type names are re-exported', () => {
    type _Surface = [
      Author,
      BuildOptions,
      BuildSummary,
      ContentGraph,
      MarkdownTransformContext,
      NavigationItem,
      NectarConfig,
      NectarEngine,
      Page,
      PaginationInfo,
      Plugin,
      PluginFactory,
      PluginRoute,
      Post,
      RenderInputs,
      RouteContext,
      RouteKind,
      SiteData,
      Tag,
      ThemeAsset,
      ThemeBundle,
      ThemeCustomSettingDefinition,
      ThemeImageSize,
      ThemePackage,
    ];
    const sentinel: _Surface | undefined = undefined;
    expect(sentinel).toBeUndefined();
  });

  test('Plugin interface accepts the documented hook surface', () => {
    const plugin: Plugin = {
      name: 'shape-test',
      beforeBuild(ctx: BuildContext) {
        expect(ctx.cwd).toBeDefined();
      },
      afterContentLoad() {},
      beforeRender() {},
      afterRender(_ctx, _route, html: string) {
        return html;
      },
      afterEmit() {},
      routes() {
        return [];
      },
      transformMarkdown(input: string) {
        return input;
      },
    };
    expect(plugin.name).toBe('shape-test');
  });
});
