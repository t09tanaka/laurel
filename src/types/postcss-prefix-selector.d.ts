declare module 'postcss-prefix-selector' {
  import type { Plugin } from 'postcss';

  export interface PrefixSelectorOptions {
    prefix: string;
    transform?: (prefix: string, selector: string, prefixedSelector: string) => string;
  }

  export default function prefixSelector(options: PrefixSelectorOptions): Plugin;
}
