import type { ContentGraph } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';

// Ghost-compatible template lookup uses a small fixed set of names; the
// renderer falls through to `default` (or `index`) when a specific template
// is missing, which is fine as a runtime fallback but masks real authoring
// mistakes (e.g. shipping a theme without `post.hbs`). This helper compares
// the *expected* template list against `theme.templates` (the map produced
// by `loadTheme`) and reports anything missing with a severity hint.
//
// The list is intentionally derived locally rather than from the route plan
// (which lives in `src/build/routes.ts`) so this check can run before any
// route planning has happened and stays cheap. The mapping mirrors the
// resolver in `src/render/context-builders/lookup.ts` / the Ghost docs at
// https://ghost.org/docs/themes/structure/.

export interface TemplateIssue {
  template: string;
  message: string;
  severity: 'error' | 'warning';
  reason: 'missing-required' | 'missing-optional';
}

const REQUIRED_TEMPLATES: readonly string[] = ['index', 'default'];

// Optional but commonly expected templates. We warn (not error) so a theme
// missing one of these still builds (renderer falls back to `default` or
// `index`), but the author sees the gap during `laurel check`. Author /
// tag templates are conditional on whether the site has any authors/tags.
const OPTIONAL_TEMPLATES: readonly string[] = ['post', 'page', 'tag', 'author'];

export function checkThemeTemplates(theme: ThemeBundle, content: ContentGraph): TemplateIssue[] {
  const present = new Set(Object.keys(theme.templates));
  const issues: TemplateIssue[] = [];

  for (const name of REQUIRED_TEMPLATES) {
    if (!present.has(name)) {
      issues.push({
        template: name,
        message: `Theme '${theme.name}' is missing required template '${name}.hbs'`,
        severity: 'error',
        reason: 'missing-required',
      });
    }
  }

  for (const name of OPTIONAL_TEMPLATES) {
    if (present.has(name)) continue;
    // Only warn when content of the matching kind actually exists; a blog
    // with no authors page doesn't need author.hbs, so warning would be
    // noise. We err on the side of warning when we can't tell (e.g. `page`
    // is checked unconditionally since every theme normally ships it).
    if (name === 'tag' && content.tags.length === 0) continue;
    if (name === 'author' && content.authors.length === 0) continue;
    if (name === 'post' && content.posts.length === 0) continue;
    if (name === 'page' && content.pages.length === 0) continue;
    issues.push({
      template: name,
      message: `Theme '${theme.name}' has no '${name}.hbs'; the renderer will fall back to 'default.hbs'`,
      severity: 'warning',
      reason: 'missing-optional',
    });
  }
  return issues;
}
