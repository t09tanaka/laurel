# Deploying Laurel to Azure Static Web Apps

Azure Static Web Apps (SWA) hosts pre-built static sites and routes them
through Azure's global edge. Laurel's build pipeline emits a minimal
`staticwebapp.config.json` that SWA picks up automatically; the rest of this
guide is the GitHub Actions wiring and the gotchas.

## Quickstart

1. Create a new Static Web App in the Azure Portal. Pick **Other** as the
   build preset (we use a custom workflow) and skip the GitHub integration
   — we'll wire it manually below.

2. From the resource page, copy the **deployment token**. It looks like a
   long base64 string and is the only secret the deploy needs.

3. In your GitHub repo, add the token as `AZURE_STATIC_WEB_APPS_API_TOKEN`
   under **Settings -> Secrets and variables -> Actions**.

4. Copy the example workflow at
   [`examples/ci/azure-static-web-apps.yml`](../../examples/ci/azure-static-web-apps.yml)
   to `.github/workflows/azure-static-web-apps.yml`.

5. Push to `main`. The workflow runs `laurel build`, then uploads `dist/`
   via the official `Azure/static-web-apps-deploy@v1` action.

## What laurel emits for Azure

Every `laurel build` writes a `staticwebapp.config.json` at the publish
root. The file is azure-specific (other hosts ignore it) and configures:

- `navigationFallback.rewrite = "/404.html"` so missing paths serve the
  themed 404 page laurel emits (`emitDefault404`), not Azure's default
  HTML.
- `navigationFallback.exclude` listing fingerprinted asset paths, content
  images, the Pagefind index dir, and XML/JSON/text/compression sidecars —
  so the SPA fallback never masks a genuine 404 for a missing static file.
- `routes` with a single `/api/*` rule that grants anonymous access. If you
  later add Azure Functions under `/api/`, they work without further
  config; if you don't, the rule is a no-op.

To override the defaults, drop your own `staticwebapp.config.json` into
laurel's static-passthrough dir (default: `<cwd>/static/`). The
post-emit passthrough step runs after every other emitter, so user-owned
files win over the built-in defaults.

## Security headers and redirects

Azure SWA reads response headers and redirects from
`staticwebapp.config.json`, **not** from laurel's `_headers` / `_redirects`
files. The default config laurel emits only carries routing rules — for
security headers, extend the file via a passthrough override:

```json
{
  "navigationFallback": {
    "rewrite": "/404.html",
    "exclude": ["/assets/*", "/content/images/*"]
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains"
  },
  "routes": [
    { "route": "/old-permalink/", "redirect": "/new/path/", "statusCode": 301 }
  ]
}
```

This is intentionally not auto-generated from `[deploy.headers]`: SWA's
header schema is structurally different from the Cloudflare / Netlify
`_headers` format, and Azure's `routes` array predates them by several
years. Keep one source of truth per platform.

## Pull-request preview environments

The example workflow uses Azure's built-in PR preview feature:
`Azure/static-web-apps-deploy@v1` recognises a pull-request event and
publishes the build to a preview slot named after the PR. Comments on the
PR include the preview URL. Closing the PR tears the slot down
automatically. No extra config needed.

## Troubleshooting

- **404s serve Azure's default page, not `/404.html`:** confirm
  `staticwebapp.config.json` made it into `dist/`. The build emits it
  unconditionally, but a user-supplied passthrough file at
  `<cwd>/static/staticwebapp.config.json` overrides it — check the override
  is valid JSON.
- **The deploy action complains about no token:** the secret must be named
  `AZURE_STATIC_WEB_APPS_API_TOKEN` exactly; the example workflow looks for
  that name. Rotate the token from the Azure resource if it gets leaked.
- **Functions calls return 401:** the default `staticwebapp.config.json`
  grants `anonymous` to `/api/*`. If you tightened it via a passthrough
  override and forgot to re-add anonymous access, calls return 401 with no
  body.
