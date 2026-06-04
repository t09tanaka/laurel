import type Handlebars from 'handlebars';
import { colorToRgba, contrastTextColorFor } from '~/util/color.ts';
import type { LaurelEngine } from '../engine.ts';

export function registerColorHelpers(engine: LaurelEngine): void {
  engine.hb.registerHelper('color_to_rgba', function colorToRgbaHelper(...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const color = args.length > 1 ? args[0] : undefined;
    if (typeof color !== 'string') return '';
    const alpha = options.hash.alpha;
    return colorToRgba(color, typeof alpha === 'number' || typeof alpha === 'string' ? alpha : 1);
  });

  engine.hb.registerHelper(
    'contrast_text_color',
    function contrastTextColorHelper(...args: unknown[]) {
      const color = args.length > 1 ? args[0] : undefined;
      return contrastTextColorFor(typeof color === 'string' ? color : undefined);
    },
  );
}
