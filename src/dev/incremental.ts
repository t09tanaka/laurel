// Dev-server side of the incremental build hand-off. `nectar dev` keeps the
// previous `build()`'s config + theme bundle in memory and feeds them back to
// the next rebuild via `BuildOptions.reuse`, skipping `loadConfig` and
// `loadTheme` (and the template-compilation work inside `createEngine`).
//
// The classification rules here are intentionally conservative: a single
// `nectar.toml` save invalidates everything, because the config drives both
// the theme dir and the content roots. A pure content edit is the biggest win
// (theme + config reused), since theme compile is the costliest load step.

export type DevChangeCategory = 'content' | 'theme' | 'config';

export interface DevReuseDecision {
  // When true, the next build() can hand back the previously-loaded config and
  // skip loadConfig. CLI-side overrides (basePath / baseUrl / copyContentAssets)
  // are re-applied by build() on top of the reused config object.
  reuseConfig: boolean;
  // When true, the next build() can hand back the previously-loaded theme
  // bundle and skip loadTheme + template compilation + locale parsing.
  reuseTheme: boolean;
}

// Decides which previously-loaded inputs the next build() can safely reuse,
// given the set of change categories observed in the current debounce window.
//
// Rules:
//   - empty set:      defensive full reload (no signal → assume the worst).
//   - has 'config':   full reload; config edits can move theme.dir / content
//                     roots, so neither cache is necessarily valid anymore.
//   - has 'theme':    reuse config; theme must reload.
//   - 'content' only: reuse both config and theme (biggest win).
export function decideDevReuse(categories: ReadonlySet<DevChangeCategory>): DevReuseDecision {
  if (categories.size === 0) return { reuseConfig: false, reuseTheme: false };
  if (categories.has('config')) return { reuseConfig: false, reuseTheme: false };
  return {
    reuseConfig: true,
    reuseTheme: !categories.has('theme'),
  };
}
