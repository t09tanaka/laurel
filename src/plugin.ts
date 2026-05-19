import type { NectarConfig } from './config/schema.ts';
import type { ContentGraph } from './content/model.ts';
import type { ThemeBundle } from './theme/types.ts';

// Runtime context that plugin / theme hooks receive. Treat these values as
// read-only snapshots of the resolved configuration, content graph and theme
// bundle for one build; mutating them is undefined behavior.
export interface BuildContext {
  readonly cwd: string;
  readonly outputDir: string;
  readonly config: NectarConfig;
  readonly content: ContentGraph;
  readonly theme: ThemeBundle;
}

// Minimal plugin shape published ahead of the runtime that calls it, so
// plugin authors can write strongly-typed code today. Additional optional
// hooks may be added in a backward-compatible way; required fields will not
// change without a version bump.
export interface NectarPlugin {
  readonly name: string;
  setup?: (ctx: BuildContext) => void | Promise<void>;
}

// Signature for a Handlebars helper registered against the Nectar engine.
// Plugin authors typing custom helpers passed to `engine.hb.registerHelper`
// should annotate them with this type.
export type NectarHelper = (this: unknown, ...args: unknown[]) => unknown;
