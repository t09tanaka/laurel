# Members in Nectar

Nectar is a **static site generator**. It has no user database, no session
cookies, no payment integration, and no server runtime that could issue or
validate a JWT. Anything Ghost's "Members" feature does *server-side* —
authentication, paywalls keyed to identity, paid-tier checks, account
management — does not exist here and cannot.

What Nectar *does* support is the **UI surface** Ghost themes expect when they
branch on members-related flags. If you wire an external membership / newsletter
provider for the dynamic parts, themes like Source render cleanly without HTML
edits.

This document covers:

1. [Migration paths off Ghost members](#1-migration-paths-off-ghost-members)
2. [What the Nectar members surface actually exposes](#2-what-the-nectar-members-surface-actually-exposes)
3. [How the portal adapter rewrites buttons and forms](#3-how-the-portal-adapter-rewrites-buttons-and-forms)
4. [Wiring examples per provider](#4-wiring-examples-per-provider)
5. [Member analytics and dashboards](#5-member-analytics-and-dashboards)
6. [Known parity gaps](#6-known-parity-gaps)
7. [Sending newsletters after a build](#7-sending-newsletters-after-a-build)

For the underlying config schema, see
[`docs/config.md` § `components.portal`](./config.md#componentsportal).
For the content-side paywall behaviour (truncating `members` / `paid` posts at
build time), see [`docs/config.md` § `content`](./config.md#content).

---

## 1. Migration paths off Ghost members

Ghost couples three things into one product: content authoring, a Members
database, and a Portal UI. Migrating to Nectar splits those out:

| Ghost component                       | Where it goes in Nectar                                                            |
|---------------------------------------|------------------------------------------------------------------------------------|
| Posts / pages / tags / authors        | `content/**/*.md` via `nectar import-ghost` (see [`docs/migration/ghost.md`](./migration/ghost.md)). |
| Members database (emails, tiers)      | Export from Ghost Admin → import into your newsletter / membership provider.       |
| Portal UI (sign in, subscribe modals) | Provider's hosted form / embed, gated by `[components.portal]` in `nectar.toml`.    |
| Paid-only / members-only posts        | Build-time paywall: body truncated, stub CTA emitted. See `[content].visibility_policy`. |

### Picking a provider

Most users replace Ghost's bundled member list with a managed newsletter / paid
subscription service. Three common targets:

| Provider     | Free tier | Paid tiers | Hosted signup form | Sign-in / account page | Notes |
|--------------|-----------|------------|--------------------|------------------------|-------|
| Buttondown   | Yes       | Yes        | Yes (POST to `https://buttondown.com/api/emails/embed-subscribe/<user>`) | Hosted on `buttondown.com/<user>` | Easiest swap for newsletter-only Ghost sites. |
| Beehiiv      | Yes       | Yes        | Yes (iframe + JS)  | Hosted on `<pub>.beehiiv.com`     | Best when you also want paid tiers + recommendations of your own. |
| Substack     | Yes       | Yes        | Yes (iframe)       | Hosted on `<pub>.substack.com`    | Closest to Ghost's bundled paid newsletter UX. |

All three accept a CSV import of `(email, name, [paid_flag])` exported from
Ghost (`Admin → Settings → Labs → Export your content`). The exact CSV column
names differ — check the provider's import docs.

> **What about self-hosting members?**
> If you want to run your own member database, you are no longer in
> "static site" territory: you need a server. Nectar will happily render the
> public surface, but the auth / subscribe API is yours to build and host
> elsewhere. The `provider = "custom"` mode (below) is the integration point.

---

## 2. What the Nectar members surface actually exposes

### `@site.members_enabled`, `@site.paid_members_enabled`, `@site.members_invite_only`

These three flags drive every Source-style theme's "should I show the sign-in
button / subscribe CTA / upgrade pill" decision. They are *derived from
`[components.portal]`* in `nectar.toml`:

| Config                                                | `@site.members_enabled` | `@site.paid_members_enabled` | `@site.members_invite_only` |
|-------------------------------------------------------|-------------------------|------------------------------|------------------------------|
| `provider = "none"` (default)                         | `false`                 | `false`                      | `false`                      |
| `provider = "ghost"` or `"custom"`                    | `true`                  | `paid` flag                   | `invite_only` flag            |

When `provider = "none"`, the Source theme's sign-in / subscribe buttons,
sidebar CTA, and footer members links collapse out entirely. That's the right
default for a plain content blog.

When `provider = "ghost"` or `"custom"`, the UI shell appears. The flags
themselves do not wire any backend — they only tell the theme *what to render*.
Wiring the actual click handlers is step 3 (see below).

### `@member.*`

Always `undefined`. In a static build there is no logged-in viewer, so the
`@member` data frame is set to `undefined` on every route (see `buildRootData`
in `src/render/engine.ts`). The key is *present* on the data frame — it just
holds `undefined` — so themes never see a partially populated or missing
member context.

The practical fallout for Source-style themes:

| Template idiom                              | Result in Nectar                                                                                  |
|---------------------------------------------|---------------------------------------------------------------------------------------------------|
| `{{#unless @member}} … {{/unless}}`         | Always renders the body (the visitor is never a member).                                          |
| `{{#if @member}} … {{/if}}`                 | Never renders the body.                                                                           |
| `{{@member.name}}` / `{{@member.email}}`    | Renders as the empty string — Handlebars' standard behaviour for property access on `undefined`.  |
| `{{#if @member.paid}} … {{/if}}`            | Never renders the body.                                                                           |
| `{{#unless @member.paid}} … {{/unless}}`    | Always renders the body — paid CTAs show to everyone.                                             |

Templates that read `@member.*` won't crash, but they also won't render
anything useful per-visitor.

Themes that need to greet a logged-in user (`Welcome back, {{@member.name}}`)
can't get that data from Nectar. You have two options:

- Hide the personalised block server-side: edit the theme to drop the greeting.
- Hide it client-side: keep the greeting in markup, then have your provider's
  JS reveal it after auth.

### `{{access}}` and `{{#unless access}}`

The `{{access}}` helper is registered but **always returns `false`** in static
builds:

```hbs
{{!-- inline form: returns the boolean false --}}
{{#if access}}...{{/if}}              {{!-- never executes the body --}}

{{!-- block form: takes the else branch --}}
{{#access}}
  This shows to logged-in members in Ghost.
{{else}}
  This shows to everyone in Nectar.
{{/access}}

{{!-- unless: always renders the body --}}
{{#unless access}}
  This block is for visitors without access.
{{/unless}}
```

The practical implication: Ghost themes that hide content behind
`{{#access}}...{{/access}}` will show the **`{{else}}` branch only**. If a
theme uses `{{#unless access}}` to render a "subscribe to read more" CTA, that
CTA will render on every page in Nectar. That is intentional — the static page
cannot prove the visitor has access, so the safe default is "treat everyone as
public, surface the upsell".

For posts whose frontmatter declares `visibility: members` or `visibility:
paid`, the body itself is truncated at build time (see
[`docs/config.md` § `content.visibility_policy`](./config.md#content)). The
`{{access}}` helper does not gate this — the truncation runs unconditionally
before the template ever sees the post.

### `{{comments}}`, `{{subscribe_form}}`, `{{input_email}}`

These helpers exist as **stable, neutral HTML hooks** so Ghost themes don't
break. They emit static markup with `data-*` attributes you can target from
your provider's snippet:

| Helper                     | Output                                                                                   |
|----------------------------|------------------------------------------------------------------------------------------|
| `{{comments}}`             | `<div data-nectar-comments></div>` — wire Giscus / Disqus / Utterances here.             |
| `{{subscribe_form}}`       | `<form data-members-form="subscribe" action="#"><input data-members-email …></form>`     |
| `{{input_email …}}`        | `<input data-members-email type="email" required …>` (just the input).                   |

Your integration replaces or augments these from `[site].codeinjection_head`
or a small `assets/js/*.js` shim.

Themes may also ship the same hooks by hand. Dawn's `partials/cover.hbs`, for
example, includes a hand-written `data-members-form` / `data-members-email`
subscribe form with `data-members-success` and `data-members-error` message
elements. Nectar preserves that HTML shape as static markup, but it does not
ship Ghost's members runtime JavaScript. Without a configured
`[components.subscribe]` provider or your own JS handler, the form remains
inert.

---

## 3. How the portal adapter rewrites buttons and forms

When `@site.members_enabled` is true, Nectar emits a small static runtime at
`assets/nectar-portal.js` and injects it through `{{ghost_foot}}`. It listens
for `[data-portal]` clicks so Ghost themes do not ship visible buttons that are
silent no-ops. The runtime uses the same URLs resolved from
`[components.portal]` as the build-time portal adapter; actions without a real
provider URL are documented stubs that log a browser-console warning.

Nectar also keeps the no-JavaScript path for things it can resolve at build
time: `src/build/portal-shim.ts` rewrites configured signup/signin/account/
upgrade buttons to anchors, and rewrites Source theme's recommendations button
to the generated `/recommendations/#all-recommendations` page.

The full picture:

| `data-portal` value | Source theme uses it for      | Nectar behaviour                                                                                  |
|---------------------|-------------------------------|---------------------------------------------------------------------------------------------------|
| `recommendations`   | Sidebar "See all" button      | Rewritten to `/recommendations/#all-recommendations` when recommendations are configured; otherwise the runtime warns. |
| `signin`            | Header "Sign in" button       | Opens the configured/inferred sign-in URL when available; otherwise the runtime warns.            |
| `signup` / `subscribe` | Sidebar Subscribe CTA      | Opens the configured/inferred signup URL when available; otherwise the runtime warns.             |
| `upgrade`           | Paid-only Upgrade button      | Opens `upgrade_url` when configured; otherwise the runtime warns because Nectar has no checkout backend. |
| `account`           | Footer "Account" link         | Opens the configured/inferred account URL when available; otherwise the runtime warns.            |

Anchors using `href="#/portal/signin"`, `href="#/portal/signup"`, etc., are
also handled by the runtime while members are enabled. If a theme or custom
script has already supplied a normal non-Portal `href`, the runtime leaves the
browser's default navigation alone.

`{{subscribe_form}}`, `{{input_email}}`, and hand-written Dawn-style subscribe
forms emit `data-members-form` / `data-members-email` attributes. Nectar's
existing subscribe-form transform only targets those explicit hooks:

| `[components.subscribe].provider` | Behaviour |
|----------------------------------------|-----------|
| `none`                                 | Keep the form shape, set `action="#"`, and add `onsubmit="event.preventDefault();return false;"`. |
| `buttondown` / `beehiiv` / `convertkit` / `mailchimp` | Patch the form `action` and email field name for the provider. |
| `listmonk`                             | Patch the form `action`, email/name fields, and inject `l` hidden fields from `list_id` / `list_ids`. |
| `customformaction` / `custom`          | Patch the form `action` and optional field mapping you configure. |

Nectar does not rewrite arbitrary forms that lack these members-form markers,
and it does not implement Ghost's runtime success / error state machine.
`data-members-success` and `data-members-error` are static presentation hooks
until your JavaScript toggles them.

Static subscribe forms never read provider secrets from environment variables.
Use only public embed values in `[components.subscribe]`: Buttondown
`username`, ConvertKit `form_id`, Mailchimp embed `action`, listmonk public
subscription `action` plus `list_id` / `list_ids`, or a `customformaction` /
`custom` `action`. If a provider workflow needs an API key, keep it behind the
configured server-side form action instead of shipping it in the static site.

The runtime dispatches a cancelable `nectar:portal` event before taking its
fallback action. Custom provider code can listen for that event, call
`preventDefault()`, and run its own modal or checkout flow without forking the
theme markup.

---

## 4. Wiring examples per provider

All examples assume a Source-derived theme. They use
`[site].codeinjection_head` (or `codeinjection_foot`) to ship the provider's
snippet without forking the theme. Set
`build.allow_code_injection = true` in `nectar.toml` to enable code injection;
see [`docs/security/threat-model.md`](./security/threat-model.md) for the
trust implications.

### 4.1 Buttondown

`nectar.toml`:

```toml
[components.subscribe]
provider = "buttondown"
username = "<your-username>"

[components.portal]
provider = "buttondown"
publication = "<your-username>"
paid = false
invite_only = false
```

Nectar rewrites `data-members-form` to Buttondown's browser-safe embed
endpoint. No environment variables or API keys are required; keep Buttondown
API keys in Buttondown or behind your own server-side proxy.

### 4.2 Beehiiv

```toml
[components.subscribe]
provider = "beehiiv"
publication_id = "<your-publication-id>"

[components.portal]
provider = "beehiiv"
publication = "<your-pub>"
paid = true        # if you sell paid tiers on Beehiiv
```

For inline subscribe forms, replace the rendered `data-members-form="subscribe"`
form with Beehiiv's iframe embed via a theme partial override.

### 4.3 ConvertKit / Kit

```toml
[components.subscribe]
provider = "convertkit"
form_id = "<your-form-id>"
```

Nectar posts to Kit's hosted form endpoint and uses `email_address` plus
`fields[first_name]` by default. No Kit API key is read from environment
variables.

### 4.4 Mailchimp

```toml
[components.subscribe]
provider = "mailchimp"
action = "https://example.us1.list-manage.com/subscribe/post?u=...&id=..."
```

Paste the public embedded-form action URL from Mailchimp. Nectar does not need
or read a Mailchimp API key.

### 4.5 listmonk

```toml
[components.subscribe]
provider = "listmonk"
action = "https://lists.example.com/api/public/subscription"
list_id = "<public-list-uuid>"
```

For multiple lists, use `list_ids = ["<uuid-a>", "<uuid-b>"]`. Nectar submits
the list UUIDs as repeated `l` hidden fields to listmonk's public subscription
endpoint, so no listmonk API token is required in the static build.

### 4.6 Custom form action

```toml
[components.subscribe]
provider = "customformaction"
action = "https://forms.example.com/newsletter"
field_map = { email = "subscriber_email", name = "subscriber_name" }
```

Use this when a provider gives you a public HTML form endpoint or when your
own serverless function owns the secrets. Nectar only rewrites the static
form; any required API keys stay outside the generated site.

### 4.7 Substack

```toml
[components.portal]
provider = "substack"
publication = "<your-pub>"
paid = true
```

For inline forms, Substack provides an `<iframe>` embed under *Settings →
Embed*. Drop it into a theme partial that overrides `subscribe-form.hbs`.

### 4.8 Self-hosted Ghost Portal (advanced)

If you run your own Ghost-compatible backend (e.g. a stand-alone Members API)
and want to reuse Ghost's own `portal.min.js`:

```toml
[components.portal]
provider = "ghost"   # ship the UI shell with #/portal/* hashes intact
paid     = true

[site]
codeinjection_head = """
<script
  defer
  src="https://your-members-host.example.com/public/portal.min.js"
  data-ghost="https://your-members-host.example.com/"
  data-api="https://your-members-host.example.com/ghost/api/content/"
  data-key="<your-content-api-key>"
></script>
"""
```

The `data-portal="..."` attributes and `href="#/portal/*"` hashes pass through
untouched; Ghost's Portal script binds them at load.

---

## 5. Member analytics and dashboards

Ghost ships `/ghost/#/dashboard` with live member growth, MRR, subscription,
and newsletter engagement charts. Nectar does not provide an equivalent
built-in member analytics dashboard because Nectar emits static files: there
is no database, event stream, email sender, checkout system, or authenticated
admin runtime for it to query after deploy.

Use the dashboard that belongs to your external ESP or hosted newsletter /
membership provider instead:

| Provider | Analytics source |
|----------|------------------|
| Buttondown | Buttondown dashboard for subscribers, paid subscriptions, opens, clicks, and broadcasts. |
| Beehiiv | Beehiiv dashboard for audience growth, revenue, referrals, newsletter engagement, and paid subscriptions. |
| Substack | Substack dashboard for subscribers, subscriptions, posts, opens, clicks, and revenue. |
| Custom / self-hosted | Your own member backend, payment provider, ESP, or product analytics stack. |

Nectar can still emit normal web analytics snippets through
[`components.analytics`](./config.md#componentsanalytics), but those track page
views on the public static site. They do not replace ESP-side subscriber
counts, MRR, open rates, paid-tier churn, or per-email campaign reporting.

---

## 6. Known parity gaps

Nectar matches Ghost's members **shape** but not its **behaviour**. The
following do not work, and there is no plan to make them work without a
server:

- **No per-user state.** `@member.*` is empty for every visitor. Themes that
  read `@member.name`, `@member.email`, `@member.paid` get empty strings, not
  real data.
- **No tier checks.** A post with `visibility: paid` is truncated for
  *everyone*. The static page cannot test "did this visitor pay" — that's a
  server query. If your provider supports JS-side gating, you can re-reveal
  the body client-side after auth; Nectar does not ship that runtime.
- **No built-in sign-in / account / upgrade pages.** The static runtime can
  route `#/portal/signin`, `#/portal/account`, and `#/portal/upgrade` clicks
  to configured provider URLs, but it does not implement Ghost's account UI.
  Billing, tier changes, comps, and invoices must live on the provider's
  hosted page.
- **No `{{#access}}` content gating.** The `{{access}}` helper always returns
  `false`, so themes can't render member-only content based on viewer
  identity. Use frontmatter `visibility` for content gating (truncates the
  body at build time) instead.
- **No paywall reveal after payment.** Buttondown / Beehiiv / Substack handle
  payment on their own hosted pages. Nectar's paywall stub
  (`<div class="gh-paywall-stub">…</div>`) is a static CTA, not a reveal.
- **No comments tied to membership.** `{{comments}}` is an empty stable hook.
  Wire Giscus / Disqus / Utterances client-side; none of them check Ghost
  member identity.
- **No built-in member analytics dashboard.** Nectar's static output cannot
  reproduce Ghost's live `/ghost/#/dashboard` member growth, MRR, or open-rate
  charts. Use your ESP / hosted newsletter provider dashboard instead.
- **Newsletter sending is out of scope.** Ghost's email newsletter feature
  (cron-driven, per-post) is not implemented. Schedule sends from your
  provider's dashboard, or trigger your own provider-specific sender from
  `[hooks].post_build` as described below.

If you need any of the above on the static side itself, you are likely
better served by running Ghost or a Ghost-compatible backend in parallel and
using Nectar only for the public reading surface.

---

## 7. Sending newsletters after a build

Ghost can emit webhooks such as `post.published` from Admin because Ghost owns
the database and publishing event. Nectar's equivalent lifecycle point is build
completion: Markdown has rendered, assets and manifests are on disk, and the
output directory is ready for deploy or follow-up automation.

Use `[hooks].post_build` for this flow:

```toml
[hooks]
post_build = "./scripts/newsletter-send.sh"
```

The command runs from the project root after a successful non-dry-run build.
Nectar sets `NECTAR_OUTPUT_DIR` to the final output directory, so the script can
inspect emitted HTML, feeds, or `.nectar/build-manifest.json` before deciding
what to send.

For member-facing newsletter delivery, keep the provider-specific logic in your
own command and call it from the hook:

```toml
[hooks]
post_build = "bun run newsletter-send"
```

That keeps content publication explicit in CI: `nectar build` produces the
site, then `newsletter-send` can publish through Buttondown, Beehiiv, Substack,
or a custom members backend using the freshly built artifacts.
