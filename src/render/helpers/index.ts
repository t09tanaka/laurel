import type { NectarEngine } from '../engine.ts';
import { registerAssetHelpers } from './assets.ts';
import { registerBlockHelpers } from './blocks.ts';
import { registerCommentCountHelper } from './comment-count.ts';
import { registerContentForHelpers } from './content-for.ts';
import { registerContentHelpers } from './content.ts';
import { registerDateHelpers } from './date.ts';
import { registerFlowHelpers } from './flow.ts';
import { registerGhostHeadFootHelpers } from './ghost-head.ts';
import { registerI18nHelpers } from './i18n.ts';
import { registerImageDimensionHelpers } from './image-dimensions.ts';
import { registerNavigationHelpers } from './navigation.ts';
import { registerNumberHelpers } from './numbers.ts';
import { registerPageUrlHelper } from './page-url.ts';
import { registerPriceHelpers } from './price.ts';
import { registerStringHelpers } from './strings.ts';
import { registerUrlHelpers } from './urls.ts';

export function registerHelpers(engine: NectarEngine): void {
  registerAssetHelpers(engine);
  registerBlockHelpers(engine);
  registerCommentCountHelper(engine);
  registerContentForHelpers(engine);
  registerContentHelpers(engine);
  registerDateHelpers(engine);
  registerFlowHelpers(engine);
  registerGhostHeadFootHelpers(engine);
  registerI18nHelpers(engine);
  registerImageDimensionHelpers(engine);
  registerNavigationHelpers(engine);
  registerNumberHelpers(engine);
  registerPageUrlHelper(engine);
  registerPriceHelpers(engine);
  registerStringHelpers(engine);
  registerUrlHelpers(engine);
}
