# Nectar — Ghost-compatible Static Site Generator

## What this project is

Nectar is a **static site generator that consumes Ghost themes** (the `.hbs` Handlebars
templates Ghost publishes use) and **Markdown content from a Git repository**, and
emits a fully static site. The runtime is Bun + TypeScript. There is no server, no
admin UI, and no database.

The compatibility target is the official Ghost **Source** theme (vendored at
`example/themes/source/`). If Source renders end-to-end against `example/` content,
Nectar's Ghost compatibility surface is doing its job.

## Architectural pillars

1. **Ghost theme compatibility** — `.hbs` templates, `{{ghost_head}}`, `{{asset}}`,
   `{{img_url}}`, partial inheritance via `{{!< layout}}`, Ghost helpers (`foreach`,
   `is`, `match`, `has`, `get`, `t`, `date`, `reading_time`, …), and the Ghost
   context shape (`@site`, `@custom`, `post`, `page`, `author`, `tag`, pagination).
2. **Markdown/Git content** — `content/posts/**/*.md` with YAML frontmatter is the
   source of truth. No CMS. `nectar build` regenerates everything.
3. **Static-only runtime** — output is plain HTML/CSS/JS/assets. No server-side
   rendering at request time. Anything that *requires* a server (members,
   subscriptions, search backend) is either stubbed or hooked through an optional
   client-only component.
4. **Optional components** — features like search, comments, RSS, sitemap, OG
   images, and JSON feeds plug in by config; they are not core.
5. **Migration tooling** — `nectar import-ghost` ingests a Ghost JSON export and
   writes Markdown + assets into `content/`.

## Repo layout

```
nectar/
├── src/                       # SSG implementation
│   ├── cli/                   # CLI entry, command dispatch
│   ├── content/               # Markdown + frontmatter loader, content graph
│   ├── theme/                 # Theme loader, .hbs discovery, asset fingerprinting
│   ├── render/                # Handlebars engine wiring, Ghost helpers, context builders
│   ├── ghost/                 # Ghost-compat surface: helpers, contexts, import tool
│   ├── build/                 # Build pipeline, routing, pagination, sitemap, asset copy
│   ├── config/                # nectar.toml schema + loader
│   └── util/                  # logger, fs helpers, path helpers
├── tests/                     # bun test suite, mirrors src/ layout
├── example/                   # The reference blog site
│   ├── nectar.toml
│   ├── content/
│   │   ├── posts/
│   │   ├── pages/
│   │   └── authors/
│   └── themes/source/         # Vendored Ghost Source theme
├── docs/                      # DESIGN.md and other design notes
├── package.json
├── tsconfig.json
├── biome.json                 # lint/format
└── CLAUDE.md / .claude/
```

## Coding standards

- **TypeScript, strict mode.** No `any`. If a type is genuinely unknown, use
  `unknown` and narrow.
- **Bun-native APIs first** (`Bun.file`, `Bun.write`, `Bun.glob`, `Bun.serve` if
  needed). Fall back to `node:fs/promises` only when Bun's surface doesn't cover
  the case.
- **Tests are colocated by mirror.** `src/render/helpers.ts` → `tests/render/helpers.test.ts`.
- **Use `bun test`.** No Jest, no Vitest.
- **Formatter/linter is Biome.** `bun run check` must pass before committing.
- **No emojis in code, comments, or filenames** unless the user asks.
- **No comments that just restate the code.** Comment only WHY when surprising.
- **Default to small, composable functions.** A file should usually be < 300 lines.
- **Errors propagate as thrown Errors with useful messages.** Wrap at boundaries.
  No silent catches.

## Ghost compatibility scoping

Ghost has a *huge* surface area. Nectar covers the subset needed to render
real-world themes against static Markdown content. The current explicit scope is:

**Implemented (MVP):**
- Layout inheritance (`{{!< default}}`), partials (`{{> "name"}}` + args)
- Built-in helpers: `if`, `unless`, `each`, `with`
- Ghost block helpers: `foreach`, `is`, `match`, `has`, `post`, `page`, `tag`,
  `author`, `get` (stubbed against local content graph)
- Ghost inline helpers: `asset`, `img_url`, `ghost_head`, `ghost_foot`,
  `body_class`, `post_class`, `meta_title`, `meta_description`, `date`, `t`,
  `url`, `concat`, `link`, `link_class`, `navigation`, `pagination`,
  `reading_time`, `excerpt`, `content`, `authors`, `tags`, `social_url`, `lang`
- Contexts: `@site`, `@blog` (alias), `@custom`, `@page`, post, page, author, tag,
  pagination
- Pagination, tag archives, author archives, post pages, static pages
- Asset fingerprinting via `{{asset}}`
- Locale-driven `{{t}}` translation from theme's `locales/*.json`

**Explicitly out of scope (for now):**
- Members, subscriptions, payments, comments — `{{comments}}` outputs empty.
- Newsletter rendering / email-only posts.
- Server-side search; client-side search can be wired as an optional component.
- Admin/edit links inside themes.
- Live preview / drafts via API.

## Workflow rules

- Default branch: `main`. PRs go against `main`.
- Use the `gh pr create` flow; never local-merge.
- Don't use `git commit --amend`. Make new commits.
- Run `bun run check && bun test` before pushing.
- Frontend text changes: get a `/ask-codex` review if the user requests one.
- Implementation/refactor: get a `/codex:review` pass after non-trivial code.

## What "done" looks like for the bootstrap milestone

`cd example && bun ../src/cli/index.ts build` (or `bunx nectar build`) writes a
static site into `example/dist/` that:

1. Has `index.html`, `<post-slug>/index.html`, `tag/<tag>/index.html`,
   `author/<author>/index.html`, and `<page-slug>/index.html`.
2. Renders using the vendored Source theme without throwing on any Ghost helper.
3. Has working `assets/built/screen.css`, fonts, JS copied with fingerprinted
   URLs in the HTML.
4. Has at least one pagination page that works.
5. Has a `sitemap.xml` and `rss.xml`.
