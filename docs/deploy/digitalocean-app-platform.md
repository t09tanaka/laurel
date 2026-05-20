# Deploying Nectar to DigitalOcean App Platform

DigitalOcean App Platform can serve a Nectar site as a static site component:
App Platform checks out the repository, runs the build command, and publishes
the generated `dist/` directory. Nectar does not currently emit a
DigitalOcean App Spec, so configure the static site in the control panel or
keep a small `.do/app.yaml` yourself.

Use App Platform when you already host apps on DigitalOcean or want a managed
Git-connected static site with custom domains handled by DigitalOcean. If you
need host-specific generated headers or redirects from Nectar, use a target
that Nectar emits today, such as Cloudflare Pages, Vercel, Netlify, or nginx.

## Quickstart: App Platform builds from Git

1. Build locally before connecting the repository:

   ```sh
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

2. Commit the project to Git, excluding `dist/` and `node_modules/`.

3. In DigitalOcean, open **Apps -> Create App**, choose your Git provider, and
   select the repository and branch.

4. Configure the resource as a **Static Site**:

   | Field | Value |
   | --- | --- |
   | Source directory | `/` unless Nectar lives in a monorepo subdirectory |
   | Build command | `bunx nectar build` |
   | Output directory | `dist` |

   DigitalOcean can scan common output directories, including `dist`, but set
   the output directory explicitly so the deploy contract stays obvious. App
   Platform detects Bun from `bun.lock` / `bun.lockb`; set a build-time
   `BUN_VERSION` environment variable if you want to pin the same Bun version
   you use locally.

5. Deploy the app. App Platform serves the built files; there is no run
   command for a static site.

## Minimal App Spec

Nectar does not currently generate `.do/app.yaml`. If you prefer App Spec
deploys, keep the file small and limited to App Platform's static site fields:

```yaml
name: my-nectar-site
static_sites:
  - name: web
    github:
      repo: your-org/your-repo
      branch: main
      deploy_on_push: true
    source_dir: /
    build_command: bunx nectar build
    output_dir: dist
    envs:
      - key: BUN_VERSION
        value: "1.3.0"
        scope: BUILD_TIME
    index_document: index.html
    error_document: 404.html
```

For GitLab or a generic Git source, replace the `github` block with the source
block DigitalOcean expects. In a monorepo, set `source_dir` to the directory
that contains `nectar.toml`; `output_dir` is relative to that build context.

## Redirects and headers

App Platform static sites do not consume Nectar's Cloudflare `_headers`,
Netlify `_headers`, Vercel `vercel.json`, or nginx config emitters. Keep the
Nectar build as plain static output and configure platform-owned behavior in
DigitalOcean:

- Custom domains, TLS, and app-level routing belong in App Platform.
- Security headers and cache behavior are not emitted by Nectar for
  DigitalOcean today. If your site requires a strict CSP, HSTS, or custom
  cache rules, verify App Platform can enforce your required policy or put a
  CDN / reverse proxy that can set those headers in front of the app.
- `redirects.yaml` is only converted for supported Nectar deploy emitters. Do
  not expect App Platform to read it from `dist/`.

## Troubleshooting

- **Build fails with `bunx: command not found`:** confirm `bun.lock` or
  `bun.lockb` is committed in the component's source directory so App Platform
  selects the Bun buildpack. Pin `BUN_VERSION` as a build-time environment
  variable if the default Bun version differs from local development.
- **Deploy succeeds but shows an empty or old site:** confirm the output
  directory is `dist` and that `bunx nectar build` ran in the directory that
  contains `nectar.toml`.
- **Nested pages 404:** Nectar writes directory-style pages such as
  `/about/index.html`. Confirm the component is a static site and that App
  Platform is serving the complete `dist/` tree.
- **Headers or redirects are missing:** this is expected unless you configure
  them in DigitalOcean or an external edge layer. Nectar has no DigitalOcean
  App Spec or headers emitter yet.
