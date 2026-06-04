# Deploying Laurel to Render Static Sites

Render Static Sites can build a Laurel project from Git and publish the
generated `dist/` directory. This guide keeps Render as the build and hosting
owner. If your team prefers GitHub Actions to run the same build first, use
the optional deploy-hook workflow at the end.

Laurel does not maintain a Render-specific redirects or headers format.
Render Static Sites read Netlify-style `_redirects` and `_headers` files from
the publish directory, so Laurel intentionally reuses the Netlify deploy
emitter when you want generated redirect and header artifacts.

## Quickstart: Render builds from Git

1. In Render, choose **New -> Static Site** and connect the Git repository
   that contains your Laurel project.

2. Set the service fields:

   | Field | Value |
   | --- | --- |
   | Root Directory | blank, unless Laurel lives in a monorepo subdirectory |
   | Build Command | `bun install --frozen-lockfile && bunx laurel build` |
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
   bunx laurel build
   test -f dist/.laurel-manifest.json
   ```

5. Commit and push to the branch Render watches. Render will install
   dependencies, run `bunx laurel build`, and serve `dist/`.

If you manage Render services through Blueprints, copy
[`examples/render/render.yaml`](../../examples/render/render.yaml) to
`render.yaml` at the repository root and adjust the service name before
creating the Blueprint. The sample uses Render's Static Site service type,
`bun install && bun run build`, and `./dist` as the published directory.

## Canonical URLs and preview paths

For a production custom domain, set the final site URL in `laurel.toml`:

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
bunx laurel build --base-url https://your-preview.onrender.com
```

Render's Git-connected build command is static, so per-preview `--base-url`
usually requires a separate environment-aware script.

## Headers and redirects

Render Static Sites can consume Netlify-style `_redirects` and `_headers`
files from the published `dist/` directory. Laurel reuses the Netlify emitter
for that format; there is no separate `[deploy.render]` config block.

To emit both files for Render, enable the Netlify deploy target in
`laurel.toml`:

```toml
[deploy.netlify]
enabled = true
```

With that enabled, Laurel writes:

- `dist/_headers` from `[deploy.headers]`
- `dist/_redirects` from `redirects.yaml`, Ghost-style
  `content/data/redirects.{yaml,yml,json}`, and generated trailing-slash rules

Leave `components.redirects.enabled` at its default unless you want to suppress
the component-level `_redirects` artifact entirely. If you need hand-authored
rules, add them through the static passthrough directory and set
`deploy.merge = true` so Laurel prepends the handwritten entries before the
generated ones.

For the security header baseline that Laurel emits into `_headers`, see
[`docs/security/hosting.md`](../security/hosting.md).

## Optional: GitHub Actions deploy hook

Render's default flow is to build directly from Git. If you want GitHub
Actions to verify the Laurel build with a pinned Bun version before asking
Render to deploy the latest commit, copy
[`examples/ci/render.yml`](../../examples/ci/render.yml) to
`.github/workflows/render.yml`.

Then in Render:

1. Keep the Static Site build command set to `bunx laurel build`.
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
  exactly `dist`, and that the build command is running from the Laurel project
  root.
- **Nested pages 404 on direct load:** Laurel emits directory-style pages such
  as `/about/index.html`; Render Static Sites should serve those from `/about/`.
  If you are proxying Render behind another layer, confirm the proxy preserves
  trailing slashes and does not rewrite every path to `/index.html`.
- **Redirects or headers do not apply:** Render is not reading Laurel's
  `_redirects` / `_headers` files as a platform contract. Configure those
  rules in Render until a Render-specific emitter exists.
