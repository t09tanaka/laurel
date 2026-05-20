# Deploying Nectar to Firebase Hosting

Firebase Hosting serves Nectar's already-built `dist/` directory as static
files. Nectar can emit a Firebase Hosting `firebase.json` into the build output
from `[deploy.firebase]`, translating the shared `deploy.headers`,
`redirects.yaml`, `build.trailing_slash`, and clean URL policy into Firebase's
native Hosting config. Nectar does not currently ship a `nectar deploy firebase`
command, so publishing still uses the Firebase CLI or the maintained GitHub
Actions sample in [`examples/ci/firebase.yml`](../../examples/ci/firebase.yml).

## Quickstart

1. Install and sign in to the Firebase CLI:

   ```sh
   npm install -g firebase-tools
   firebase login
   ```

2. Create or select a Firebase project, then initialize Hosting from the
   Nectar project root:

   ```sh
   firebase init hosting
   ```

   When prompted, use:

   | Prompt | Value |
   | --- | --- |
   | Public directory | `dist` |
   | Configure as a single-page app | `No` |
   | Set up automatic builds and deploys with GitHub | `No` |

   Nectar emits real HTML files and directory `index.html` files, not a
   client-side SPA shell. Do not add a catch-all rewrite to `/index.html`
   unless your site intentionally needs SPA behavior.

3. Enable the Firebase emitter in `nectar.toml`:

   ```toml
   [deploy.firebase]
   enabled = true
   ```

   `nectar build` writes `dist/firebase.json` with `hosting.public = "."`.
   This makes the output directory self-contained: run the Firebase CLI from
   `dist/`, or copy the generated `hosting` block into a root-level
   `firebase.json` if your deployment workflow must run from the project root.

   The generated config sets `cleanUrls: true` and maps
   `build.trailing_slash` to Firebase's `trailingSlash` boolean. It emits
   `rewrites: []` by default because Nectar emits real HTML files and
   directory `index.html` files, not a client-side SPA shell.

4. Build and test locally:

   ```sh
   bunx nectar build
   cd dist
   firebase emulators:start --only hosting
   ```

   Open the printed local Hosting URL and click through posts, tag pages, RSS,
   and assets before publishing.

5. Deploy the static output:

   ```sh
   cd dist
   firebase deploy --only hosting
   ```

   For GitHub Actions, copy
   [`examples/ci/firebase.yml`](../../examples/ci/firebase.yml) to
   `.github/workflows/firebase.yml`, add the `FIREBASE_SERVICE_ACCOUNT` secret
   and `FIREBASE_PROJECT_ID` variable, and keep `entryPoint: dist` so
   FirebaseExtended/action-hosting-deploy reads Nectar's generated
   `dist/firebase.json`.

## Redirects

Nectar's generic redirects component can emit `dist/_redirects`, but Firebase
Hosting does not read Netlify / Cloudflare Pages `_redirects` files. When
`[deploy.firebase].enabled = true`, Nectar also folds the canonical redirect
rules into `dist/firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "redirects": [
      {
        "source": "/feed",
        "destination": "/rss.xml",
        "type": 301
      },
      {
        "source": "/old-post",
        "destination": "/new-post/",
        "type": 308
      }
    ]
  }
}
```

Firebase applies redirect rules before static file lookup, and rules are
first-match. Nectar preserves the same collapsed first-match order used by the
other deploy emitters.

## Headers and caching

Firebase reads custom response headers from the `headers` array in
`firebase.json`. With `[deploy.firebase].enabled = true`, Nectar translates
`[deploy.headers]` into that array, using Firebase recursive globs such as
`/assets/**` and `**`.

Use long-lived immutable cache headers only for fingerprinted or otherwise
stable asset paths such as `/assets/**` and `/content/images/**`. Keep HTML,
feed, sitemap, and JSON responses revalidating so a deploy becomes visible
without waiting for a browser cache to expire.

For a fuller security baseline, copy the Firebase example from
[`docs/security/hosting.md`](../security/hosting.md#firebase-hosting) into the
same `headers` array.

## Clean URLs and trailing slashes

Nectar's canonical page shape is a trailing-slash URL backed by a directory
index file:

| Public URL | Generated file |
| --- | --- |
| `/` | `dist/index.html` |
| `/about/` | `dist/about/index.html` |
| `/tag/news/` | `dist/tag/news/index.html` |

Firebase Hosting has separate switches for `.html` extension cleanup and
trailing slash redirects:

- `cleanUrls` controls whether uploaded `*.html` files are exposed without
  the `.html` suffix.
- `trailingSlash` controls whether static content URLs are globally redirected
  to add or remove a final slash.
- When `trailingSlash` is omitted, Firebase uses trailing slashes for
  directory index files such as `about/index.html`.

Nectar maps `build.trailing_slash = "always"` to `"trailingSlash": true` and
`"never"` to `"trailingSlash": false`. The generated config also sets
`"cleanUrls": true`, which lets any standalone `*.html` files copied into
`dist/` be served without the `.html` suffix.

## Custom domains and paths

For a custom domain served from the root path, set the deployed URL in
`nectar.toml` and leave `base_path` as `/`:

```toml
[site]
url = "https://blog.example.com/"

[build]
base_path = "/"
```

Firebase Hosting normally serves each site at the domain root. If you put a
Nectar build behind another Firebase route or CDN path such as `/blog/`, set
`[build].base_path` to that path, including leading and trailing slashes, and
update `[site].url` to the final public URL.

## Troubleshooting

- **Deploy says `dist` does not exist:** run `bunx nectar build` before
  deploying, then run the Firebase CLI from `dist/` or copy the generated
  Hosting block into your root `firebase.json`.
- **Every route shows the home page:** remove any catch-all rewrite to
  `/index.html`; Nectar is not an SPA.
- **Redirects from `redirects.yaml` do nothing:** enable `[deploy.firebase]`
  and deploy with the generated `firebase.json`; Firebase ignores
  `dist/_redirects`.
- **Header changes do not appear:** confirm the rule's `source` pattern matches
  the deployed file and redeploy with `firebase deploy --only hosting`.
