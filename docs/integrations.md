# Integrations

Laurel is static-first. Integrations that need a request-time database, signed
webhooks, or per-viewer state must be handled by your host, a plugin, or a
third-party service. This page records the supported static contracts and the
places where Laurel deliberately emits an explicit non-support artifact.

## Fediverse and WebFinger

Laurel does not implement ActivityPub actors, inboxes, outboxes, HTTP
signatures, delivery, or query-aware WebFinger responses. Every build emits
`.well-known/laurel-fediverse.json` so deploy audits can see that ActivityPub
and WebFinger are intentionally unsupported by the static generator rather than
silently missing.

If your host can serve query-aware files, you may place hand-written
`.well-known/webfinger` or related files in the configured static directory.
Laurel copies static passthrough files last, so those host-specific files can
override generated `.well-known` artifacts.

## Comments and Webmentions

`[components.comments]` supports `giscus`, `disqus`, `utterances`, and
`webmention.io`. For Webmention.io:

```toml
[components.comments]
provider = "webmention.io"
username = "example.com"
```

The `{{comments}}` helper emits a static `<div data-laurel-webmentions>` with
the canonical target URL. Fetching, rendering, moderation, and receive endpoint
handling remain the responsibility of your client script or Webmention.io
account.

## Analytics Segments

Laurel can inject simple analytics snippets through
`[components.analytics]`. Static builds cannot know the current visitor's live
membership state, so membership segmentation should be derived from content
metadata that is present at build time:

- `post.visibility`: `public`, `members`, `paid`, `tiers`, or `filter`.
- `post.tiers`: configured `[[tiers]]` attached to the post.
- `@site.members_enabled` and `@site.paid_members_enabled`: publication-level
  UI flags.

For provider-specific events, add a plugin `afterRender` hook or trusted
`codeinjection_head` snippet that reads these static attributes from the page
context you render.

## Members and Tiers

Laurel exposes static tier data from `[[tiers]]` to `{{#get "tiers"}}`,
`{{tiers}}`, and the default `{{> pricing-table}}` partial. There is no built-in
checkout or account database.

For Ghost's free-tier welcome-page convention, create a normal page at
`/welcome/free/` and point the free tier at it:

```toml
[[tiers]]
name = "Free"
welcome_page_url = "/welcome/free/"
```

Each build also emits `.laurel/portal-manifest.json`, listing the
`data-portal` selectors Laurel rewrites or leaves to the runtime warning path.
Use it in theme QA when checking signup, signin, account, upgrade, invite-only,
and recommendations links.

## Newsletter Delivery

Web and email output do not share identical policies:

- `feature_image_caption` can contain HTML on the web, but email pipelines
  should strip or sanitize it before delivery.
- `post.excerpt` and `custom_excerpt` are safe teaser sources; provider-specific
  truncation should be tested against the actual email renderer.
- `email_only: true` posts are excluded from public routes unless
  `build.emit_email_only_stub = true`.

Use `[hooks].post_build` for Postmark, Resend, SES, or custom newsletter
delivery commands. The hook runs after a successful non-dry-run build with
`LAUREL_OUTPUT_DIR` pointing at the final output directory.

## Observability

Use build metadata and plugin hooks instead of a built-in Sentry or Bugsnag
client:

- `[build.metadata].build_id` and `commit_sha` surface as `@site.build`.
- `LAUREL_BUILD_ID` and `LAUREL_COMMIT_SHA` can populate those fields in CI.
- `--profile` emits `.laurel-build-stats.json` with route and helper timing.
- Plugin `beforeBuild`, `beforeRender`, `afterRender`, and `afterEmit` hooks can
  report errors or traces to your own backend.

Laurel does not catch and forward build exceptions to a vendor SDK. CI should
capture stderr and upload logs or diagnostics bundles through your existing
observability stack.

## Packaging

Laurel's only official distribution channel is npm. Install it with
`npm i -g laurel` (or run it with `bunx laurel`) on a host that has
[Bun](https://bun.sh) >= 1.3.

Any other packaging (Homebrew, Scoop, AUR, Nix, container images) is left to
downstream maintainers who wrap the npm package and own their own update
cadence; the project does not publish or maintain those artifacts.

## i18n

Laurel resolves `site.locale` from BCP 47 tags, derives `@site.direction` as
`rtl` for right-to-left languages, and formats `{{date}}` in
`site.timezone`. `{{t}}` supports Ghost-style string lookup, `{name}`
interpolation, and `%` positional placeholders. It is not an ICU MessageFormat
engine; use the `{{plural}}` helper for simple singular/plural branches.
