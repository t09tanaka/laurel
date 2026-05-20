# Adding a Ghost Card

Use this checklist when adding a new Ghost / Koenig card to Nectar. A card is
not complete until import, Markdown rendering, shared card assets, fixtures, and
regression tests all agree on the same public `kg-*` DOM contract.

The best exemplar is the Bookmark card. It has the full round-trip path:

- Import/Turndown rule:
  `src/ghost/turndown-rules.ts` (`kg-bookmark-card` in
  `registerGhostCardRules`)
- Markdown shortcode grammar:
  `src/content/markdown.ts` (`BOOKMARK_SHORTCODE_RE`,
  `LIQUID_BOOKMARK_SHORTCODE_RE`, and `expandKoenigShortcodes`)
- Shortcode handler:
  `src/content/markdown.ts` (`renderBookmarkHtml`)
- Theme CSS:
  `src/build/card-assets.ts` (`bookmark` in `CARD_NAMES` and `CARD_CSS`)
- Fixture:
  `tests/fixtures/cards/bookmark.md`
- Contract tests:
  `tests/ghost/turndown-rules.test.ts` and `tests/content/cards.test.ts`

## 1. Add the import/Turndown rule

Add or update the card rule used by `nectar import-ghost`.

- Start in `src/ghost/turndown-rules.ts`; `src/ghost/import.ts` calls
  `createGhostTurndown()`, so card import behavior must flow through that
  Turndown setup.
- Match the Ghost wrapper as narrowly as possible, for example
  `.kg-bookmark-card`, `.kg-gallery-card`, or a `data-kg-card` fence wrapper.
- Preserve every field that cannot be recovered later: URLs, captions, alt text,
  dimensions, width modifiers, colors, provider names, poster images, tracks,
  button labels, and runtime-relevant `data-*` attributes.
- Emit a self-describing shortcode or directive shape that is stable enough for
  hand-edited Markdown.
- Escape shortcode attributes with the shared helpers instead of string
  concatenation.
- Add Turndown tests in `tests/ghost/turndown-rules.test.ts` for the full card
  shape and at least one sparse/minimal variant.

## 2. Add the Markdown shortcode or directive grammar

Teach the Markdown renderer to recognize the imported carrier syntax.

- Add the regex/parser entry in `src/content/markdown.ts` near the existing
  Koenig shortcode patterns.
- Register it in `expandKoenigShortcodes()` before Markdown is passed to
  `marked`.
- Prefer the existing `{{< card ... />}}`, block `{{< card >}}...{{< /card >}}`,
  or legacy Liquid-style `{% card ... %}` forms already used by neighboring
  cards.
- Keep imported syntax readable and diffable. Avoid requiring JSON blobs unless
  Ghost's payload is genuinely nested and cannot be represented clearly.
- Reuse `parseShortcodeAttrs()` for flat attributes so escaping stays symmetric
  with Turndown output.

## 3. Add the shortcode handler

Render the shortcode back into the static `kg-card` HTML shape Ghost themes
expect.

- Add a focused `render<Card>Html()` handler in `src/content/markdown.ts`, or
  reuse an existing handler if the card is an alias of an implemented shape.
- Emit Ghost-compatible wrapper classes first, usually
  `kg-card kg-<name>-card`, followed by width/style modifier classes.
- Escape text and attributes with the local helpers. Do not pass imported text
  straight into HTML.
- Keep the output static-first. If Ghost relies on runtime JavaScript, render a
  usable fallback and add any progressive enhancement in shared card assets.
- Update `sanitizeOptions` in `src/content/markdown.ts` only when the rendered
  card requires a new safe tag, attribute, style property, or URL scheme.

## 4. Add shared theme CSS and optional runtime hooks

Make the card readable in themes that opt into Nectar's shared card assets.

- Add the card name to `CARD_NAMES` in `src/build/card-assets.ts`.
- Add the minimal CSS for the public `kg-*` contract to `CARD_CSS`.
- If the card needs tiny static enhancement, add it to `renderCardAssetsJs()`.
  Keep it defensive and skip it when the card is listed in
  `theme.package.config.card_assets.exclude`.
- Add or update `tests/build/card-assets.test.ts` when the new CSS/runtime
  section changes the emitted asset contract.

## 5. Add the fixture

Add a canonical fixture under `tests/fixtures/cards/<card>.md`.

- The fixture should use the exact Markdown syntax the import step emits.
- Include enough metadata to exercise the public DOM contract: width, caption,
  media attributes, nested rows, fallback URL, or button text as appropriate.
- Update `tests/fixtures/cards/README.md` only if the corpus conventions change
  or the new card needs special fixture notes.

## 6. Add snapshot or contract tests

Pin both directions of the round trip.

- In `tests/content/cards.test.ts`, assert that the fixture renders the expected
  root wrapper and important child hooks. For complex cards, normalize
  inter-tag whitespace and compare the full DOM shape, as the Bookmark card
  does.
- In `tests/ghost/turndown-rules.test.ts`, assert that Ghost HTML imports into
  the shortcode/directive syntax from step 2.
- If the card is emitted by Lexical or Mobiledoc fixtures, update
  `tests/ghost/import.cards.test.ts`, `tests/ghost/lexical-renderer.test.ts`,
  or `tests/ghost/mobiledoc-renderer.test.ts` as needed.
- Run the narrow tests for the changed surface, then `bun run check` and
  `git diff --check`.

## Done Definition

Before committing, verify that:

- A Ghost export can import the card without losing card-specific metadata.
- The imported Markdown renders without leaking raw shortcode text.
- The rendered HTML exposes stable `kg-card` classes and child hooks for Ghost
  themes.
- Shared card assets include enough CSS/runtime for a readable static fallback.
- The fixture corpus covers the new syntax.
- Tests prove both import-to-Markdown and Markdown-to-HTML behavior.
