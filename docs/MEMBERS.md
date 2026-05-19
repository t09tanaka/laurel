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
5. [Known parity gaps](#5-known-parity-gaps)

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

Always undefined / empty. In a static build there is no logged-in viewer, so
fields like `@member.name`, `@member.email`, `@member.paid` resolve to empty
strings (Nectar's context proxy returns `""` for unknown keys). Templates that
read `@member.*` won't crash, but they also won't render anything useful.

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
break. They emit no-op markup with `data-*` attributes you can target from
your provider's snippet:

| Helper                     | Output                                                                                   |
|----------------------------|------------------------------------------------------------------------------------------|
| `{{comments}}`             | `<div data-nectar-comments></div>` — wire Giscus / Disqus / Utterances here.             |
| `{{subscribe_form}}`       | `<form data-members-form="subscribe" action="#"><input data-members-email …></form>`     |
| `{{input_email …}}`        | `<input data-members-email type="email" required …>` (just the input).                   |

Your integration replaces or augments these from `[site].codeinjection_head`
or a small `assets/js/*.js` shim.

---

## 3. How the portal adapter rewrites buttons and forms

Nectar's portal adapter (`src/build/portal-shim.ts`) does **one thing
automatically**: it rewrites Source theme's
`<button data-portal="recommendations">` into an anchor that deep-links to the
auto-generated `/recommendations/#all-recommendations` page. Everything else
about `data-portal="*"` is left alone for the provider's script to handle.

The full picture:

| `data-portal` value | Source theme uses it for      | Nectar behaviour                                                                                  |
|---------------------|-------------------------------|---------------------------------------------------------------------------------------------------|
| `recommendations`   | Sidebar "See all" button      | **Rewritten** to `<a href=".../recommendations/#all-recommendations">` (works without JS).        |
| `signin`            | Header "Sign in" button       | Untouched. Inert under `provider = "none"`. Under `ghost` / `custom`, your script intercepts it.  |
| `signup`            | Sidebar Subscribe CTA         | Untouched. Same handling rules.                                                                   |
| `upgrade`           | Paid-only Upgrade button      | Untouched. Same handling rules.                                                                   |
| `account`           | Footer "Account" link         | Untouched. Same handling rules.                                                                   |

Anchors using `href="#/portal/signin"`, `href="#/portal/signup"`, etc., are
also passed through verbatim. They are **inert hash fragments** unless a
client-side script wires them up.

`{{subscribe_form}}` and `{{input_email}}` emit `data-members-form` /
`data-members-email` attributes; your provider snippet attaches form handlers
via those selectors. There is no automatic rewrite — the no-op form will
submit to `#` if you don't intercept it, so wire something in or hide it via
CSS.

### Why the asymmetry?

The recommendations button is rewritten because its target — the
`/recommendations/` page — is something Nectar itself emits, deterministically.
The other `data-portal` values target server endpoints that *only exist if you
bring a backend*. Rewriting them to a dead route would mask the absence of
that backend; leaving them as `data-portal="..."` keeps the integration
contract visible and lets your provider snippet hook them at runtime.

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
[components.portal]
provider = "custom"   # show the UI shell; we'll wire the handlers
paid     = false
invite_only = false

[site]
codeinjection_head = """
<script>
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-portal="signup"], [data-portal="signin"], a[href^="#/portal"]');
    if (!trigger) return;
    e.preventDefault();
    window.open('https://buttondown.com/<your-username>', '_blank', 'noopener');
  });
</script>
"""
```

To replace the `{{subscribe_form}}` no-op form with Buttondown's hosted form,
override the theme partial that renders it (e.g.
`partials/components/subscribe-form.hbs`) with the embed Buttondown gives you
under *Settings → Subscribe form → Embed*.

### 4.2 Beehiiv

```toml
[components.portal]
provider = "custom"
paid     = true        # if you sell paid tiers on Beehiiv

[site]
codeinjection_head = """
<script async src="https://embeds.beehiiv.com/attribution.js"></script>
<script>
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-portal="signup"], [data-portal="signin"], [data-portal="upgrade"]');
    if (!trigger) return;
    e.preventDefault();
    window.open('https://<your-pub>.beehiiv.com/subscribe', '_blank', 'noopener');
  });
</script>
"""
```

For inline subscribe forms, replace the rendered `data-members-form="subscribe"`
form with Beehiiv's iframe embed via a theme partial override.

### 4.3 Substack

```toml
[components.portal]
provider = "custom"
paid     = true

[site]
codeinjection_head = """
<script>
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-portal="signup"], [data-portal="signin"], [data-portal="upgrade"]');
    if (!trigger) return;
    e.preventDefault();
    window.location = 'https://<your-pub>.substack.com/subscribe';
  });
</script>
"""
```

For inline forms, Substack provides an `<iframe>` embed under *Settings →
Embed*. Drop it into a theme partial that overrides `subscribe-form.hbs`.

### 4.4 Self-hosted Ghost Portal (advanced)

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

## 5. Known parity gaps

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
- **No sign-in / account / upgrade pages.** Hash routes like
  `#/portal/signin`, `#/portal/account`, `#/portal/upgrade` are inert in the
  static build. Wiring them is up to your provider script (section 3 above).
  The full Ghost "account management" UI — billing, tier change, comp,
  invoices — is not reproducible statically and must live on the provider's
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
- **Newsletter sending is out of scope.** Ghost's email newsletter feature
  (cron-driven, per-post) is not implemented. Schedule sends from your
  provider's dashboard.

If you need any of the above on the static side itself, you are likely
better served by running Ghost or a Ghost-compatible backend in parallel and
using Nectar only for the public reading surface.
