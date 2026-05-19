# Threat model — trust boundaries in a Nectar build

Nectar is a static site generator. Everything inside this document is about
**what runs at build time** on the operator's machine (or in CI) and **what
ends up in the static HTML/CSS/JS** that visitors see. There is no Nectar
process at request time — see [hosting.md](./hosting.md) for the headers the
host has to set on top of what Nectar emits.

This document exists because Nectar deliberately consumes three different kinds
of input — Markdown content, a Ghost theme, and `nectar.toml` config — and the
trust each one carries is wildly different. A blog operator who accepts outside
contributions to `content/` is not necessarily extending the same trust to
whoever wrote the theme, and the threat surface differs accordingly.

If you maintain a Nectar site and merge PRs from people other than yourself,
read this end-to-end. Most issues here boil down to "review the diff" — but
you have to know which lines in the diff matter.

## Trust levels

| Surface              | Default trust         | Effect if abused                                                         | Mitigation surface                                              |
| -------------------- | --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `content/**/*.md` body              | Untrusted by default  | Markdown is sanitized; raw HTML stripped unless `unsafe_html: true` set per post | Markdown sanitizer + per-post `unsafe_html` opt-in            |
| `content/**/*.md` frontmatter       | Semi-trusted          | Most fields land in `<meta>` / `<title>` (HTML-escaped). A few fields are render-sensitive — see below | Per-field sanitization + `build.allow_code_injection` gate    |
| `themes/<name>/**`                  | **Fully trusted (= code)** | Theme `.hbs` templates are Handlebars code with access to the full site graph; theme `assets/` ship as-is | Treat as code. Review like code. Pin like code.               |
| `nectar.toml`                       | **Fully trusted (= site owner)** | `site.url`, `theme.custom.*`, `build.allow_code_injection` flip site-wide behavior | Operator-only. Not a contributor-editable file in normal flow. |
| Host HTTP response headers          | Operator-controlled, out of Nectar | Missing CSP/HSTS weakens defense-in-depth | See [hosting.md](./hosting.md)                                  |

The rest of this page expands each row.

## Surface 1: Markdown content (`content/posts/**`, `content/pages/**`)

This is the surface most people will accept PRs against. Outside contributors
write Markdown, frontmatter, and drop image assets in `content/images/`.

### Body Markdown

The post body is rendered through a Markdown renderer that does **not** allow
raw HTML by default. A contributor who pastes `<script src="//evil.tld/x.js">`
into the middle of a paragraph gets that text rendered verbatim as visible
characters, not executed.

To opt in per-post, a frontmatter field exists:

```yaml
---
title: Example
unsafe_html: true
---
This now allows <iframe src="..."> and other raw HTML.
```

**Treat `unsafe_html: true` as code.** Any PR adding it should be reviewed the
same way you would review a JavaScript change — it lets the post body smuggle
arbitrary HTML (and therefore `<script>`) into the page.

### Frontmatter fields with extra render power

Most frontmatter fields (`title`, `excerpt`, `tags`, `feature_image`, …) are
escaped before they reach the DOM. A few are not, and these are the lines
reviewers should flag:

| Field                          | Why it's dangerous                                                                                                                                                 | Default state           | What to look for in a PR diff                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codeinjection_head`           | Spliced verbatim into `<head>` via `{{ghost_head}}` when `build.allow_code_injection = true`. Equivalent to a `<script>` tag the contributor controls.             | Disabled (stripped with a warning unless the operator opts in via `nectar.toml`) | Any non-empty value. Especially `<script>`, `<iframe>`, `<link rel=preload as=script>`. Treat as code change.                                          |
| `codeinjection_foot`           | Same as `codeinjection_head` but inserted via `{{ghost_foot}}`, typically just before `</body>`. Same blast radius — ships site-wide JS once merged.               | Disabled (stripped with a warning unless `allow_code_injection = true`) | Same as above.                                                                                                                                         |
| `feature_image_caption`        | Themes typically render this with `{{{feature_image_caption}}}` (triple-stash, no escaping). Nectar pre-sanitizes to inline-only HTML at load time, so `<script>` / `<iframe>` cannot reach the DOM — but the field is still HTML, not plain text. | Sanitized to inline tags | Suspicious patterns that hint someone is probing the sanitizer (encoded payloads, weird nesting). Plain `<em>`/`<a>` is fine.                          |
| `unsafe_html: true`            | Lets the post body contain raw HTML (see previous section).                                                                                                        | Off                     | Any PR adding this. Review the body that follows as if it were JS.                                                                                     |
| `slug`                         | Becomes a path segment. Nectar runs every user-supplied slug through `slugify(..., { strict: true })`, so traversal (`../`) and HTML are flattened out — but two contributors can still race to claim the same slug and shadow each other's content. | Slugified                | Slugs colliding with existing posts/pages (`index`, `tag`, `author`, `rss`, `sitemap`, etc.).                                                          |
| `visibility: members` / `paid` | Drives whether the post body gets truncated, dropped, or rendered in full. Set globally via `content.visibility_policy`. Not an XSS vector, but a contributor can silently flip a post to `members` and hide content from readers. | `public`                | Changes to `visibility` on a previously-public post.                                                                                                   |

The thing to internalize: **if a contributor can merge a PR that adds
`codeinjection_*` and `build.allow_code_injection` is `true`, that contributor
can ship arbitrary JavaScript to every page of the site.** Either keep the
flag off, or treat `codeinjection_*` lines in a PR diff with the same scrutiny
as a change to a JavaScript bundle.

### Render-side raw-HTML exits — `{{ghost_head}}` / `{{ghost_foot}}`

`{{ghost_head}}` and `{{ghost_foot}}` are the **only two render helpers in
Nectar that emit author-controlled HTML verbatim**, with no escaping. That is
intentional and required for Ghost theme compatibility — themes rely on these
helpers to splice analytics tags, comments bootstraps, and other inline
`<script>` / `<link>` snippets that the post author configured. Every other
Ghost helper (`title`, `excerpt`, `meta_description`, `feature_image`, …) is
either HTML-escaped or passes through Nectar's content sanitizer first.

In other words: the render layer has exactly **one explicit XSS exit, and it
is gated behind `build.allow_code_injection`**. When the gate is off, the
loader strips `codeinjection_head` / `codeinjection_foot` before the helpers
ever see them; when it is on, whatever the post author put there ships
unmodified.

This is safe **only as long as `content/` is treated as code**: the trust
boundary is the operator's PR-review process, not a runtime sanitizer.
Anyone who can land a PR that edits a frontmatter file with
`codeinjection_*` and the gate enabled can publish arbitrary script to every
page on the site.

**Recommended defence in depth: a CSP that pins inline scripts.** Even with
`allow_code_injection` enabled and trusted authors, configure the host to
send a `Content-Security-Policy` header that constrains what those inline
scripts can do. Two viable approaches for a static deploy:

- **Edge-injected nonces.** A Cloudflare Worker / Vercel Edge / Netlify Edge
  function rewrites the response per request: generate a fresh nonce, attach
  it to every legitimate `<script>` / `<style>` tag emitted by Nectar, and
  emit a matching `script-src 'nonce-…'; style-src 'nonce-…'` header. This
  is the cleanest path because it does not require build-time bookkeeping
  and works with arbitrary `codeinjection_*` content.
- **Precomputed hashes.** Run a post-build step that hashes every inline
  `<script>` / `<style>` block in `dist/` and emits a `_headers` /
  `vercel.json` with `'sha256-…'` entries in `script-src` / `style-src`.
  This pins exactly the scripts your build produced; any new inline script
  from a malicious `codeinjection_*` after the build would be blocked.
  Trade-off: hashes change on every build, so the header file is rebuilt
  too.

See [`hosting.md`](./hosting.md) for the baseline CSP and tightening steps.
Neither edge nonces nor precomputed hashes are bundled with Nectar today;
both are operator-side wiring on top of the static output.

### Content assets (`content/images/`)

Images and other binary assets in `content/images/` are copied to the output
under the same relative path. Two things to keep in mind:

- Large files inflate the output. `build.max_image_bytes` (default 5 MiB)
  refuses to copy raster images bigger than the threshold; raise it
  deliberately, don't silently bump it.
- Anything in `content/images/` is web-accessible. Don't drop secrets there.

## Surface 2: Themes (`themes/<name>/**`)

**A Ghost theme is code.** Handlebars templates can call any registered helper,
read `@site`, `@custom`, the full post graph, and emit inline `<script>` and
`<style>` blocks. The vendored `example/themes/source/` is upstream Ghost code
and has been treated as such; a third-party theme could do anything Handlebars
allows.

This means:

- **Vet third-party themes the same way you vet npm packages.** Read the
  `default.hbs`, search for `<script>`, search for `{{{` (triple-stash) usage,
  look at what `partials/` are doing.
- **Pin the theme.** Vendor it into the repo or pin the upstream commit. Do
  not auto-update on every build.
- **Don't accept theme changes from random contributors** unless you also
  trust them to ship JavaScript. A line of Handlebars in `default.hbs` can
  embed an analytics tag, a tracking pixel, or anything else.
- **Theme `assets/` ship as-is.** CSS, JS, fonts, and images in the theme
  directory get copied to the output under fingerprinted URLs but are not
  inspected. A theme that drops a `theme.js` file ships that file to every
  visitor.

If you do not maintain the theme yourself, the operator must accept that the
theme author has the same level of access to the site as the operator does.

## Surface 3: `nectar.toml`

The config file is the operator's lever. A few fields have site-wide
security-relevant effects:

| Field                              | Effect                                                                                                                                                                          | Recommendation                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site.url`                         | Used to build canonical links, sitemap URLs, RSS GUIDs, and absolute OG image URLs. If wrong, links 404 and feed readers may dedupe incorrectly.                                | Set to the exact production origin. Don't mix `http://` and `https://`. Don't include a trailing slash unless your routing depends on it.                 |
| `theme.custom.*`                   | Free-form values surfaced to templates as `@custom`. Whether they're rendered escaped or raw depends on the theme. A theme that does `{{{custom.banner_html}}}` will run any HTML you put there. | Treat values as plain text unless you've read the theme. If you do need raw HTML in `@custom`, you already trust the theme — but document it.            |
| `build.allow_code_injection`       | Enables per-post `codeinjection_head` / `codeinjection_foot`. With this off, contributors cannot inject inline scripts via frontmatter; with it on, they can.                   | Leave off unless you trust everyone with `content/` write access to ship JavaScript. If you turn it on, gate `content/` write access behind code review. |
| `build.max_image_bytes`            | Cap on per-file raster image size when copying content assets.                                                                                                                  | 5 MiB default. Don't disable (`0`) unless you have a separate image pipeline.                                                                            |
| `content.visibility_policy`        | What happens to `visibility: members` / `paid` posts in a static build. `truncate` cuts the body, `render-full` ships the whole body, `skip` drops the post.                    | If you import from a Ghost site that had paid posts, default `truncate` is the safe option — `render-full` will leak content meant to be paywalled.       |

`nectar.toml` is not a file outside contributors should be able to merge
changes to without explicit operator review. In practice this is enforced by
the same code-review process that protects the theme.

## Defense in depth: hosting headers

Even if every input above is trusted, set the headers documented in
[hosting.md](./hosting.md). `Content-Security-Policy`, `Strict-Transport-Security`,
`X-Content-Type-Options`, and friends turn many of the failure modes above
into bounded incidents rather than full site compromise.

The realistic attack on a static blog isn't "Nectar has an RCE." It's
"a contributor merged a `codeinjection_foot` PR while
`allow_code_injection = true` and shipped a cryptominer to every page."
A CSP that disallows `script-src` from untrusted origins limits the damage
to inline-only payloads; HSTS prevents downgrades; `Referrer-Policy`
narrows what trackers can correlate. All of this is the host's job, but
the operator has to configure it.

## Quick PR-review checklist

When reviewing a PR against a Nectar repo, scan for:

- [ ] `unsafe_html: true` added to any post → review body as if it were JS.
- [ ] Any non-empty `codeinjection_head` / `codeinjection_foot` → review as code; confirm `build.allow_code_injection` policy.
- [ ] `<script>`, `<iframe>`, encoded payloads in `feature_image_caption` → probe attempts.
- [ ] Slug collisions with existing routes (`index`, `tag/*`, `author/*`, `rss`, `sitemap`).
- [ ] Edits under `themes/<name>/**` → treat as code review, including `assets/`.
- [ ] Edits to `nectar.toml`, especially `site.url`, `theme.custom.*`, `build.allow_code_injection` → operator-level decisions.
- [ ] New / replaced files in `content/images/` larger than expected.

If a PR touches none of the above, it's a content change and standard editorial
review applies.
