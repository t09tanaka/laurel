# Hosting security headers

Laurel emits plain static files. The host serves them. That means **the
hosting platform is responsible for HTTP response headers** — Laurel itself
cannot send a `Content-Security-Policy` or `Strict-Transport-Security`
header at request time, because there is no Laurel process at request time.

This page collects copy-pasteable header snippets for the hosted platforms
the [deploy tutorial](../tutorials/04-deploy.md) covers (Cloudflare Pages,
Vercel, Netlify, Firebase Hosting, GitHub Pages), plus the matching
`laurel.toml` settings for self-hosted nginx. Pick the one that matches your
host and add it to the place that host actually reads.

> If you skip this step, your site ships with the defaults the host gives you.
> On most free tiers that means **no CSP, no HSTS, no Referrer-Policy** — fine
> for a personal site, risky for one that accepts contributions to `content/`,
> uses `build.allow_code_injection`, or serves a custom domain.

For the build-time side — which frontmatter and config fields ship code to
visitors, and what to look for when reviewing a contributor's PR — see
[`threat-model.md`](./threat-model.md). The two pages complement each other:
`threat-model.md` covers what Laurel emits, `hosting.md` covers what the host
wraps around that output.

## What Laurel actually emits

The CSP below is calibrated for what Laurel puts on the page:

- **Inline `<script type="application/ld+json">`** — the `{{ghost_head}}`
  helper emits JSON-LD for the site, post, and author. JSON-LD blocks are not
  executable JavaScript, but the CSP spec treats them as inline scripts, so
  `script-src` has to allow them.
- **Inline `<script>` for comments / search / analytics** — when an optional
  component is enabled (`[components.comments]`, `[components.search]`,
  `[site].analytics`), the helper emits an inline bootstrap snippet alongside
  the third-party `<script src=…>`.
- **Theme-controlled inline scripts** — Ghost themes embed inline
  `<script>` for things like menu toggles. The vendored Source theme is mostly
  external, but third-party themes vary.
- **`codeinjection_head` / `codeinjection_foot`** — opt-in via
  `build.allow_code_injection`. When enabled, posts can splice arbitrary HTML
  including inline `<script>`.
- **Inline `<style>`** — themes commonly inline critical CSS in `<head>`.

This is why the baseline CSP allows `'unsafe-inline'` for `script-src` and
`style-src`. When `[deploy.headers].security.content_security_policy` is set,
Laurel also scans the final rendered HTML and appends build-time
`'sha256-...'` sources for every non-empty inline `<script>` body to
`script-src` in generated deploy artifacts (`_headers`, `vercel.json`,
self-hosted snippets, and the CloudFront response headers policy). That lets a
strict CSP allow exactly the inline scripts the build produced without relying
on `'unsafe-inline'` for scripts.

**Per-request nonces are not viable in the static origin itself** — there is no
Laurel process at request time to emit a fresh nonce per response. One
operator-side path remains if you need fresh per-request authorization
(particularly when `build.allow_code_injection` is on — see
[`threat-model.md` § Render-side raw-HTML exits](./threat-model.md#render-side-raw-html-exits--ghost_head--ghost_foot)):

1. **Edge-injected nonces** via a Cloudflare Worker / Vercel Edge / Netlify
   Edge function that rewrites inline `<script>` / `<style>` tags with a
   fresh nonce per request and sets the matching CSP header. This works with
   arbitrary `codeinjection_*` content because the nonce is applied to the
   response, not the build output.

Laurel's built-in hashes cover inline scripts only. Inline `<style>` still
needs `'unsafe-inline'`, `build.csp_nonce` with a matching static nonce source,
edge-injected nonces, or an operator-managed style hash pass. The simpler
alternative — move every inline script out of templates and drop
`'unsafe-inline'` from `script-src` entirely — is fine for a personal blog but
conflicts with Ghost theme compatibility, since most Source-family themes ship
inline bootstraps.

## Baseline header set

These are the headers every static site should set, regardless of host:

| Header                       | Value (baseline)                                                                                                                  | Why                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` | Blocks third-party scripts, plugins, and clickjacking. See notes below for tightening it. |
| `Strict-Transport-Security`  | `max-age=31536000; includeSubDomains`                                                                                             | Forces HTTPS for a year. Add `; preload` only after submitting to the HSTS preload list.  |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                                                                 | Sends the full URL on same-origin navigations, only the origin on cross-origin.           |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                         | Prevents MIME-sniffing attacks on user-uploaded or generated files.                       |
| `X-Frame-Options`            | `DENY`                                                                                                                            | Legacy clickjacking guard. CSP `frame-ancestors 'none'` supersedes it on modern browsers. |
| `Permissions-Policy`         | `interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()`                                    | Opts out of FLoC / Topics and disables sensor APIs the blog does not need.                |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                     | Isolates the browsing context group, mitigating Spectre-class cross-origin leaks.         |

Apply the CSP to **HTML responses only**. Static assets (CSS, JS, images,
fonts) do not need a CSP, and applying one to them can produce noise in
browser devtools. The snippets below scope CSP to `/*` so it applies to
HTML — adjust if you serve non-HTML files at the same paths.

### Tightening the CSP

Once your site is stable and you know which inline scripts you actually
need, walk the policy in:

1. **Drop `'unsafe-inline'` from `style-src`** if your theme has no inline
   `<style>` (Source emits only `<link rel="stylesheet">`).
2. **Restrict `img-src`** from `https:` to the specific hosts you use
   (`'self' data: https://cdn.example.com`). The `https:` wildcard is the
   loosest practical value because Markdown content commonly references
   off-site images.
3. **Restrict `connect-src`** to the hosts your comments / search /
   analytics components actually call.
4. **Drop `'unsafe-inline'` from `script-src`** after enabling
   `[deploy.headers].security.content_security_policy` and confirming the
   generated deploy artifact contains `sha256-...` entries for the inline
   scripts you keep. Rebuild the deploy artifact whenever inline script content
   changes.

Use [Mozilla Observatory](https://observatory.mozilla.org/) or
[securityheaders.com](https://securityheaders.com/) to verify the
deployed policy and see what else the host adds or strips.

---

## Cloudflare Pages

Cloudflare Pages reads a `_headers` file at the root of `dist/`. Create one
with a build step, or check it in if you do not generate it. The simplest
path is to keep a `public/_headers` in your repo and have Laurel copy it
through to `dist/`:

```bash
mkdir -p public
```

`public/_headers`:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
```

Then either:

- Configure Laurel to copy `public/` into `dist/` as a build step
  (`cp -r public/. dist/` in a `predeploy` script), **or**
- Place `_headers` directly in your repo and let Cloudflare pick it up from
  there if your build output directory is the repo root.

Cloudflare's `_headers` syntax supports glob paths (`/blog/*`) and `!`
negation. Full reference:
<https://developers.cloudflare.com/pages/configuration/headers/>.

---

## Vercel

Vercel reads `vercel.json` from the project config or static deploy output.
For Laurel sites, prefer `[deploy.vercel].enabled = true` so `laurel build`
emits `dist/vercel.json` from `[deploy.headers]` and `build.trailing_slash`.
If you manage Vercel config by hand, headers are declarative:

`vercel.json`:

```json
{
  "cleanUrls": true,
  "trailingSlash": true,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains"
        },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        {
          "key": "Permissions-Policy",
          "value": "interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()"
        },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

If you already have a hand-maintained `vercel.json`, merge the `headers` array
into it rather than replacing the file. Keep `cleanUrls: true` with
`trailingSlash: true` only for Laurel's default `build.trailing_slash =
"always"` output; for no-slash builds, use `trailingSlash: false` with
`cleanUrls: true` instead. Otherwise, set the same policies under
`[deploy.headers]` and let Laurel generate the Vercel file. Vercel reference:
<https://vercel.com/docs/projects/project-configuration#headers>.

---

## Netlify

Netlify reads either `_headers` at the publish root (same format as
Cloudflare) or a `[[headers]]` block in `netlify.toml`. The `netlify.toml`
form is preferred because it lives next to the rest of the build config:

`netlify.toml` (merge with the block from the deploy tutorial):

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"
    Referrer-Policy = "strict-origin-when-cross-origin"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Permissions-Policy = "interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()"
    Cross-Origin-Opener-Policy = "same-origin"
```

Netlify reference:
<https://docs.netlify.com/routing/headers/>.

---

## Firebase Hosting

Firebase Hosting reads response headers from the `headers` array in
`firebase.json`. Enable `[deploy.firebase]` to have Laurel translate
`[deploy.headers]` into the generated `dist/firebase.json`:

`laurel.toml`:

```toml
[deploy.firebase]
enabled = true

[deploy.headers.security]
content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
strict_transport_security = "max-age=31536000; includeSubDomains"
referrer_policy = "strict-origin-when-cross-origin"
content_type_options = "nosniff"
frame_options = "DENY"
permissions_policy = "interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()"
cross_origin_opener_policy = "same-origin"
```

Merge this with any cache rules in
[`docs/deploy/firebase-hosting.md`](../deploy/firebase-hosting.md). Firebase reference:
<https://firebase.google.com/docs/hosting/full-config>.

The Firebase emitter maps `build.trailing_slash` into the generated
`trailingSlash` boolean and sets `cleanUrls: true`.

---

## nginx

Laurel emits nginx headers into `dist/.laurel/nginx.conf` when
`[deploy.nginx].enabled = true`. Put the security values in `laurel.toml`
under `[deploy.headers].security` so they are generated alongside the cache
rules and repeated inside every nginx `location` block:

```toml
[deploy.nginx]
enabled = true
root = "/var/www/laurel"
server_name = "example.com"

[deploy.headers.security]
content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
strict_transport_security = "max-age=31536000; includeSubDomains"
referrer_policy = "strict-origin-when-cross-origin"
content_type_options = "nosniff"
frame_options = "DENY"
permissions_policy = "interest-cohort=(), browsing-topics=(), geolocation=(), camera=(), microphone=(), payment=()"
cross_origin_opener_policy = "same-origin"
```

Then rebuild and include the generated file from nginx's top-level
`http { ... }` context:

```nginx
include /var/www/laurel/.laurel/nginx.conf;
```

Laurel's generated block listens on port 80. Keep TLS certificates,
HTTP-to-HTTPS redirects, and any load-balancer-specific behavior in your
operator-managed nginx config. See [`../deploy/nginx.md`](../deploy/nginx.md)
for the full deploy flow.

---

## GitHub Pages

**GitHub Pages does not let you set custom response headers.** It always
sends a fixed set (`Strict-Transport-Security`, `X-Frame-Options: DENY`,
some others) and ignores `_headers` / `vercel.json` / `netlify.toml`. There
is no public API to override this, and GitHub Actions cannot change it by
uploading extra files in the Pages artifact. Laurel's GitHub Pages target only
emits files Pages actually consumes, such as `.nojekyll` and optional `CNAME`;
it intentionally does not promise a headers artifact for Pages.

Use one of these options if you need a custom CSP, stricter cache headers, or
headers such as `Referrer-Policy`, `Permissions-Policy`, and
`Cross-Origin-Opener-Policy`:

1. **Front GitHub Pages with Cloudflare.** Point your domain at Cloudflare,
   set Cloudflare as a proxy to `<user>.github.io`, and apply the headers
   from a Cloudflare Worker, Transform Rule, or other CDN rule. This keeps
   GitHub Pages as the origin while moving header control to the fronting
   layer.
2. **Move the deploy to a host with first-class header config.** Cloudflare
   Pages and Netlify both pull from the same GitHub repo and accept a
   `_headers` file. Vercel accepts `vercel.json`. Self-hosted nginx can use
   the `dist/.laurel/nginx.conf` generated from `[deploy.headers]`.
3. **Put another reverse proxy or CDN in front of Pages.** Any layer that
   terminates HTTPS and controls the response can add the headers before the
   browser sees the page.
4. **Use a `<meta http-equiv="Content-Security-Policy">` tag in
   `default.hbs`.** This works for CSP only (HSTS, COOP, Permissions-Policy
   cannot be set this way), and it is weaker than an HTTP header because it
   does not apply to the document until the meta tag is parsed. Useful as a
   defence-in-depth measure, not a substitute.

For option 4, add this near the top of `<head>` in your theme:

```handlebars
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">
```

Note that `frame-ancestors` cannot be set via meta — keep it as an HTTP
header (or rely on `X-Frame-Options: DENY` which GitHub Pages already
sends).

---

## Verifying

After deploying:

```bash
curl -sI https://your-site.example/ | sort
```

Check that every header above is present, with the expected value. Then
run one of:

- <https://observatory.mozilla.org/> — graded report plus suggestions.
- <https://securityheaders.com/> — header-only grade, fast feedback loop.
- <https://csp-evaluator.withgoogle.com/> — paste your CSP, get an
  itemized critique.

Re-verify after any theme change that adds a new `<script src=…>` or
`<style src=…>` — your CSP probably needs a new entry in `script-src` /
`style-src` for it.

---

## Related

- [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md) — bare deploy
  configs without security headers.
- [`SECURITY.md`](../../SECURITY.md) — reporting vulnerabilities,
  `codeinjection_*` / `unsafe_html` trust model.
- OWASP Secure Headers Project:
  <https://owasp.org/www-project-secure-headers/>.
