# Deploying Nectar to Render Static Sites

Render Static Sites can build a Nectar project from Git and publish the
generated `dist/` directory. This guide keeps Render as the build and hosting
owner. If your team prefers GitHub Actions to run the same build first, use
the optional deploy-hook workflow at the end.

Nectar currently emits plain static files for Render. There is no
Render-specific `render.yaml` emitter, and Nectar does not translate
`[deploy.headers]` or `redirects.yaml` into Render-managed headers or
redirects. Track those settings in the Render dashboard until a dedicated
emitter exists.

## Quickstart: Render builds from Git

1. In Render, choose **New -> Static Site** and connect the Git repository
   that contains your Nectar project.

2. Set the service fields:

   | Field | Value |
   | --- | --- |
   | Root Directory | blank, unless Nectar lives in a monorepo subdirectory |
   | Build Command | `bun install --frozen-lockfile && bunx nectar build` |
   | Publish Directory | `dist` |
   | Auto-Deploy | `Yes` for the production branch |

3. Add an environment variable:

   | Key | Value |
   | --- | --- |
   | `BUN_VERSION` | `1.3.0` |

   Render installs the requested Bun version before running the build command.
   Keep this aligned with the Bun version used locally and in CI.

4. Build locally once before the first Render deploy:

   ```sh
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

5. Commit and push to the branch Render watches. Render will install
   dependencies, run `bunx nectar build`, and serve `dist/`.

If you manage Render services through Blueprints, copy
[`examples/render/render.yaml`](../../examples/render/render.yaml) to
`render.yaml` at the repository root and adjust the service name before
creating the Blueprint. The sample uses Render's Static Site service type,
`bun install && bun run build`, and `./dist` as the published directory.

## Canonical URLs and preview paths

For a production custom domain, set the final site URL in `nectar.toml`:

```toml
[site]
url = "https://blog.example.com/"
```

Render Static Sites normally serve from `/`, so leave `[build].base_path` at
its default `/`. Only set `base_path` if you intentionally publish under a
subpath behind another proxy.

For preview deploys that need canonical URLs to point at the preview hostname,
run a local or CI build with:

```sh
bunx nectar build --base-url https://your-preview.onrender.com
```

Render's Git-connected build command is static, so per-preview `--base-url`
usually requires a separate environment-aware script.

## Headers and redirects

Nectar has first-class emitters for some static hosts, but not for Render
today:

- no `[deploy.render]` config block
- no generated `render.yaml`
- no Render-native headers or redirects generated from `[deploy.headers]`
- no Render-native redirects generated from `redirects.yaml`

If `components.redirects.enabled` is left at its default, Nectar can still
write `dist/_redirects` for hosts that understand that file, but Render Static
Sites do not consume it as a routing contract. Configure redirects and custom
headers in the Render dashboard, or place a hand-maintained Render config in
your repository if your Render service is set up to use one. For a minimal
hand-maintained Blueprint, start from
[`examples/render/render.yaml`](../../examples/render/render.yaml).

For the security header baseline to mirror on Render, start from
[`docs/security/hosting.md`](../security/hosting.md) and enter the same header
values in Render's static-site settings.

## Optional: GitHub Actions deploy hook

Render's default flow is to build directly from Git. If you want GitHub
Actions to verify the Nectar build with a pinned Bun version before asking
Render to deploy the latest commit, copy
[`examples/ci/render.yml`](../../examples/ci/render.yml) to
`.github/workflows/render.yml`.

Then in Render:

1. Keep the Static Site build command set to `bunx nectar build`.
2. Keep the publish directory set to `dist`.
3. Create a Deploy Hook from the service settings.
4. Add the hook URL to GitHub Actions secrets as `RENDER_DEPLOY_HOOK_URL`.

The workflow builds `dist/`, uploads it as a short-lived artifact for
inspection, then calls the deploy hook. Render still checks out the latest
commit and publishes its own `dist/`; the artifact is not uploaded to Render.

Use only one production trigger. If Render's Auto-Deploy is enabled and the
deploy hook also fires on every push, the same commit can queue two deploys.
Either leave Auto-Deploy on and skip the workflow, or disable Auto-Deploy and
let the workflow call the hook after a successful build.

## Troubleshooting

- **`bunx: command not found`:** add `BUN_VERSION = "1.3.0"` to the Render
  environment variables, then redeploy.
- **The site deploys but assets 404:** confirm the publish directory is
  exactly `dist`, and that the build command is running from the Nectar project
  root.
- **Nested pages 404 on direct load:** Nectar emits directory-style pages such
  as `/about/index.html`; Render Static Sites should serve those from `/about/`.
  If you are proxying Render behind another layer, confirm the proxy preserves
  trailing slashes and does not rewrite every path to `/index.html`.
- **Redirects or headers do not apply:** Render is not reading Nectar's
  `_redirects` / `_headers` files as a platform contract. Configure those
  rules in Render until a Render-specific emitter exists.
