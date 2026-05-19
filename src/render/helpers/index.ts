import type { NectarEngine } from '../engine.ts';
import { registerAssetHelpers } from './assets.ts';
import { registerBlockHelpers } from './blocks.ts';
import { registerContentHelpers } from './content.ts';
import { registerDateHelpers } from './date.ts';
import { registerFlowHelpers } from './flow.ts';
import { registerGhostHeadFootHelpers } from './ghost-head.ts';
import { registerI18nHelpers } from './i18n.ts';
import { registerNavigationHelpers } from './navigation.ts';
import { registerNumberHelpers } from './numbers.ts';
import { registerStringHelpers } from './strings.ts';
import { registerUrlHelpers } from './urls.ts';

export function registerHelpers(engine: NectarEngine): void {
  registerAssetHelpers(engine);
  registerBlockHelpers(engine);
  registerContentHelpers(engine);
  registerDateHelpers(engine);
  registerFlowHelpers(engine);
  registerGhostHeadFootHelpers(engine);
  registerI18nHelpers(engine);
  registerNavigationHelpers(engine);
  registerNumberHelpers(engine);
  registerStringHelpers(engine);
  registerUrlHelpers(engine);
}
