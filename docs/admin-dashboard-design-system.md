# Nectar Admin Dashboard Design System

This document defines the visual design system for the Nectar local Admin
dashboard. It translates the note.com design research into Nectar's
file-first, Markdown-first, static publishing context.

Source reference: note (https://note.com/) design research based on production
CSS observations, including Tailwind CSS v3.4.1, Svelte scoped styles, and CSS
custom properties.

## 1. Visual Theme and Atmosphere

Nectar Admin should feel like a calm editorial workbench: readable, warm,
minimal, content-first, and focused on the writer's work rather than on the
interface itself.

The UI should preserve generous whitespace while still behaving like a dense
operations tool. Article-oriented surfaces should keep readable line lengths,
with 620px as the target width for prose content. The dashboard shell may use
wider working regions, but editor prose and preview text must not become
overly long.

Use `#08131a` as the near-black foundation instead of pure black. This keeps
long reading and editing sessions softer while preserving strong contrast.
Dark mode must be implemented through CSS custom properties rather than ad hoc
component overrides.

## 2. Color Palette and Roles

### Brand and Action

| Role | Value | Usage |
| --- | --- | --- |
| Note green reference | `#5ac8b8` | Brand/accent reference only; avoid body text usage. |
| CTA background | `#08131a` | Primary actions in light mode. |
| CTA reaction | `#202a30` | Hover/pressed state for primary actions. |
| Focus ring | `#292d9e` | Keyboard focus and accessible focus outlines. |

### Semantic Colors

| Role | Surface/Text | Subdued | Usage |
| --- | --- | --- | --- |
| Success | `#1e7b65` | `#e6f6f2` | Saved, synced, build fresh. |
| Danger | `#b22323` | `#fdf3f3` | Conflict, destructive action, validation failure. |
| Caution | `#916626` | `#fefbea` | Stale build, external change, scheduled caveat. |
| Like/offer reference | `#d13e5c` | n/a | Reaction-like emphasis only; not a primary dashboard color. |
| Badge | `#d53c21` | n/a | Notification count and urgent compact badges. |
| Point text | `#8b7f2c` | n/a | Minor point/currency-style metadata if needed. |

### Neutral Scale

| Token | Value | Usage |
| --- | --- | --- |
| Gray 900 | `#08131a` | Primary text. |
| Gray 800 | `#202a30` | Strong text and primary hover surfaces. |
| Gray 700 | `#363f42` | Emphasized UI text. |
| Gray 600 | `#5a656b` | Secondary text. |
| Gray 500 | `#7e888f` | Low-emphasis text. |
| Gray 400 | `#9ca7ad` | Placeholder text. |
| Gray 300 | `#aeb7bd` | Disabled foreground. |
| Gray 200 | `#c5ccd1` | Light borders. |
| Gray 100 | `#dce0e3` | Default borders. |
| Gray 50 | `#f5f8fa` | Secondary backgrounds. |

### Text, Surfaces, and Borders

| Token | Light value | Dark value / note |
| --- | --- | --- |
| Text primary | `#08131a` | `hsla(0, 0%, 100%, 0.90)` |
| Text secondary | `rgba(8, 19, 26, 0.66)` | `hsla(0, 0%, 100%, 0.66)` |
| Clickable icon | `rgba(8, 19, 26, 0.50)` | Theme token equivalent. |
| Disabled text | `rgba(8, 19, 26, 0.50)` | Theme token equivalent. |
| Placeholder | `#888` | Theme token equivalent. |
| Background primary | `#ffffff` | Dark mode token. |
| Background secondary | `#f5f8fa` | Dark mode token. |
| Surface normal | `#ffffff` | Dark mode token. |
| Surface primary | `#08131a` | Use for strong actions. |
| Surface secondary | `#43709d` | Use sparingly for file/build context. |
| Surface tertiary | `#5a656b` | Lower-priority filled controls. |
| Surface quaternary | `#f5f8fa` | Quiet panels and toolbar wells. |
| Surface invert | `#000000` | Only for inverted media/social references, not text. |
| Border default | `rgba(8, 19, 26, 0.14)` | Default component boundaries. |
| Border strong | `rgba(8, 19, 26, 0.22)` | Active or emphasized boundaries. |
| Border weak | `#f5f8fa` | Subtle dividers. |
| Border primary | `#08131a` | Selected strong controls. |
| Border invert | `#ffffff` | Inverted surfaces. |

### Social Reference Colors

Use these only when a dashboard surface explicitly previews or validates a
social integration: note `#5ac8b8`, X/Twitter `#000000`, Facebook `#1877f2`,
Hatena `#00a4df`, LINE `#00b900`, Threads `#000000`.

## 3. Typography

### Font Stacks

Default sans-serif:

```css
font-family: "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
  Arial, "Noto Sans JP", Meiryo, sans-serif;
```

Optional prose serif:

```css
font-family: "Hiragino Mincho ProN", "Hiragino Mincho Pro", HGSMinchoE,
  "Yu Mincho", YuMincho, "MS PMincho", serif;
```

Monospace:

```css
font-family: SFMono-Regular, Consolas, Menlo, Courier, monospace;
```

Numeric-only surfaces may use `"Open Sans", sans-serif` if numeric alignment
or scanability requires it. Emoji-heavy labels may use the existing platform
emoji stack, but ordinary dashboard UI should remain on the default sans-serif
stack.

### Type Scale and Rhythm

| Role | Size | Weight | Line height | Letter spacing | OpenType |
| --- | --- | --- | --- | --- | --- |
| Article/editor title | 32px | 700 | 48px | 0.04em | `palt` |
| Article/editor h2 | 28px | 700 | 36px | 0.04em | `palt` |
| Prose body | 18px | 400 | 36px | normal | normal |
| Dashboard section heading | 16px | 600 | 24px | normal | normal |
| Card/list heading | 16px | 600 | 24px | 0.04em | `palt` |
| Compact caption | 12px | 600 | 18px | normal | normal |
| Button | 16px | 400-700 | 24px | normal | normal |
| Input | 14px | 400 | 21px | normal | normal |

Guidelines:

- Use `letter-spacing: 0.04em` and `font-feature-settings: "palt"` only for
  headings.
- Do not apply heading spacing or `palt` to paragraph body copy.
- Keep article/editor prose at `18px` with `line-height: 2`.
- Keep dashboard UI copy tighter and smaller than editor prose.
- Enable `word-wrap: break-word`, `font-kerning: auto`,
  `-webkit-font-smoothing: antialiased`, and
  `-moz-osx-font-smoothing: grayscale` globally.

## 4. Component Styling

### Buttons

Primary buttons use `#08131a` backgrounds, white text, 16px type, and 700
weight when used as the dominant action. Hover and pressed states use
`#202a30`. Disabled surfaces use `rgba(0, 0, 0, 0.14)` and disabled text
tokens.

Secondary and tertiary buttons should use borders or quiet surfaces rather than
new accent colors. Icon-only buttons must have accessible labels and at least a
44px by 44px touch target.

### Cards and Panels

Use cards only for repeated items, modals, and genuinely framed tools. Avoid
cards inside cards. Dashboard sections should be unframed layouts or full-width
bands, not floating marketing-style sections.

Card baseline:

- Background: `#ffffff`
- Border: `rgba(8, 19, 26, 0.14)`
- Border radius: 8px for Nectar dashboard components; 12px only when matching
  a note-inspired content card is intentional.
- Shadow: use elevation tokens sparingly and only to express layering.

### Navigation

Navigation uses a white background, `rgba(8, 19, 26, 0.14)` bottom border, and
compact height: 64px on desktop, 48px on mobile. Keep labels direct and
operational: Posts, Pages, Authors, Tags, Settings, Sync.

### Status Badges

Dashboard badges must communicate file-backed state, not generic CMS status.
Use the semantic palette for Saved, Dirty, External Change, Conflict, Build
Stale, Draft, Scheduled, and Published. Badges should remain compact and must
not become explanatory paragraphs.

## 5. Layout Principles

| Area | Width | Usage |
| --- | --- | --- |
| Main content | 940px | Primary dashboard content region. |
| Article/prose | 620px | Editor prose and readable preview content. |
| Timeline/feed | 580px | Activity and sync timeline. |
| Editor | 580px | Focused text editing column. |
| Two-column main | 610px | Main panel in detail screens. |
| Two-column side | 280px | Metadata, sync, and inspector panels. |

Use a 4px spacing base scale. Preserve calm whitespace around editor surfaces,
but keep list, settings, and sync views dense enough for repeated operational
use.

## 6. Depth and Elevation

| Token | Shadow | Usage |
| --- | --- | --- |
| `--elevation-1` | `0px 1px 3px 1px rgba(0,0,0,0.14), 0px 1px 2px 0px rgba(0,0,0,0.22)` | Cards and low floating surfaces. |
| `--elevation-4` | `0px 4px 8px 3px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.22)` | Dropdowns and popovers. |
| `--elevation-6` | `0px 6px 10px 4px rgba(0,0,0,0.14), 0px 2px 3px 0px rgba(0,0,0,0.22)` | Modals and dialogs. |

Use the hover/reaction overlay `rgba(8, 19, 26, 0.03)` for quiet interactive
feedback. Do not use shadow as decoration.

## 7. Responsive Behavior

| Breakpoint | Width | Usage |
| --- | --- | --- |
| XS | 361px | Narrow mobile. |
| SM | 481px | Mobile. |
| MD | 769px | Tablet. |
| LG | 941px | Small desktop. |
| XL | 1280px | Desktop. |
| 2XL | up to 2048px | Large displays. |

Touch targets must be at least 44px by 44px. Long Japanese text, long slugs,
and long file paths must wrap or use middle truncation without widening the
layout. Do not scale typography with viewport width.

Dark mode must work with both `prefers-color-scheme: dark` and a `.theme-dark`
class. All semantic colors should switch through CSS custom properties.

## 8. Do and Do Not

Do:

- Use `#08131a` for primary text instead of pure black.
- Use opacity variants of the same near-black for secondary text.
- Keep prose at `18px` with `line-height: 2`.
- Apply `letter-spacing: 0.04em` and `palt` only to headings.
- Keep readable prose width at 620px.
- Use CSS custom properties for light/dark tokens.
- Keep dashboard copy short, operational, and tied to file-backed state.

Do not:

- Use pure `#000000` for ordinary text.
- Expand prose beyond 620px.
- Use `#5ac8b8` as body text on white backgrounds.
- Mix sans-serif and serif within the same body passage.
- Apply heading letter spacing or `palt` to paragraphs.
- Add decorative gradients, nested cards, or single-hue dashboard themes.
- Treat live preview as a substitute for saved-file preview or deploy status.

## 9. Implementation Quick Reference

```text
Brand reference: #5ac8b8
CTA background: #08131a
Text primary: #08131a
Text secondary: rgba(8, 19, 26, 0.66)
Background: #ffffff
Background secondary: #f5f8fa
Border: rgba(8, 19, 26, 0.14)
Like/reference reaction: #d13e5c
Danger: #b22323
Success: #1e7b65
Focus ring: #292d9e

Sans-serif:
"Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
Arial, "Noto Sans JP", Meiryo, sans-serif

Serif:
"Hiragino Mincho ProN", "Hiragino Mincho Pro", HGSMinchoE,
"Yu Mincho", YuMincho, "MS PMincho", serif

Dashboard body: 16px / line-height 1.5 / letter-spacing normal
Article body: 18px / line-height 2 / letter-spacing normal
Headings: letter-spacing 0.04em + font-feature-settings "palt"
Readable article width: 620px
```

