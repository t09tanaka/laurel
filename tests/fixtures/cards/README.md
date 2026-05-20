# Card fixture corpus

Smoke-test inputs for every Koenig card type Nectar's `renderMarkdown` is
expected to round-trip without dropping or mangling. Each `.md` file holds the
shortcode / shortcode-equivalent HTML the markdown loader actually receives
when a Ghost-imported post lands in `content/posts/`, and
`tests/content/cards.test.ts` pins the structural shape of the rendered
output.

The corpus exists to:

- Document the canonical input form per card so theme authors and plugin
  writers know what to target.
- Catch regressions where a markdown / sanitisation tweak silently strips a
  card. Each fixture asserts the kg-card class hook still reaches the
  rendered HTML.
- Provide stubs for cards Nectar does not natively expand. Those fixtures
  document the fall-through behaviour (markup left intact when shaped as
  raw HTML, dropped to an empty paragraph for `<!--kg-card-begin: X-->`
  comment fences with no inner content).

Cards that **require** a plugin to materialise (signup, recommendations beyond
their static HTML scaffold) keep their kg-class wrapper so the plugin can
target it; the regression assertion checks the wrapper survives sanitisation.

See `src/ghost/koenig-card-html.ts` for the renderers that produce these
HTML shapes during `nectar import-ghost`, and `docs/THEME_DEV.md` for how
the kg-card class hooks plug into theme CSS.
