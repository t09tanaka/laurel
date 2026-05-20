# Deploying Nectar to Fly.io

Fly.io runs applications from container images. Nectar emits static files to
`dist/`, and the sample under [`examples/fly/`](../../examples/fly/) treats Fly
as a small nginx container that serves that pre-built directory.

Use this guide when you want Fly's app platform, regions, TLS, and rollout
model for a static Nectar site. If you only need to smoke-test the container
locally, start with [`docs/deploy/docker.md`](./docker.md).

## Prerequisites

- A working Nectar build:

  ```sh
  bunx nectar build
  test -d dist
  ```

- The Fly CLI installed and authenticated:

  ```sh
  flyctl auth login
  ```

- A Fly app created once, before CI deploys:

  ```sh
  flyctl launch --no-deploy
  ```

  Keep the generated `fly.toml` in the repo, then review it against
  [`examples/fly/fly.toml`](../../examples/fly/fly.toml).

## Static nginx sample

Copy the Fly sample files to the project root:

```sh
cp examples/fly/fly.toml fly.toml
cp examples/fly/Dockerfile Dockerfile
cp examples/fly/nginx.conf nginx.conf
```

The sample [`Dockerfile`](../../examples/fly/Dockerfile) assumes
`bunx nectar build` already ran before `flyctl deploy`. The matching GitHub
Actions template at [`examples/ci/fly.yml`](../../examples/ci/fly.yml) builds
`dist/` first, then lets Fly build and release this small nginx image.

The sample [`nginx.conf`](../../examples/fly/nginx.conf) is intentionally
static-only: it serves Nectar's `slug/index.html` output with
`try_files $uri $uri/ $uri/index.html =404;`, falls back to the generated
`404.html` page, and pins the default long-lived asset paths. It does not
translate `redirects.yaml` or every custom `[deploy.headers]` override. For
those production concerns, either adapt the sample config or use the generated
nginx config flow described in
[`docs/deploy/docker.md`](./docker.md#optional-generate-a-nectar-nginx-config).

## Minimal fly.toml

The sample [`fly.toml`](../../examples/fly/fly.toml) listens on port 80 inside
the container:

```toml
app = "my-nectar-site"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

If `flyctl launch --no-deploy` generated extra sections for your app, keep the
ones you need. This guide intentionally does not define a Nectar-specific
healthcheck because Nectar ships static files and Fly/nginx already provide the
runtime process. Add one only if your own operations policy requires it, for
example:

```toml
[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  method = "GET"
  path = "/"
```

## Deploy from GitHub Actions

1. Copy [`examples/ci/fly.yml`](../../examples/ci/fly.yml) to
   `.github/workflows/fly.yml`.
2. Copy [`examples/fly/fly.toml`](../../examples/fly/fly.toml),
   [`examples/fly/Dockerfile`](../../examples/fly/Dockerfile), and
   [`examples/fly/nginx.conf`](../../examples/fly/nginx.conf) to the project
   root.
3. Create a Fly API token:

   ```sh
   flyctl auth token
   ```

4. Store it as the repository secret `FLY_API_TOKEN`.
5. Push to `main` or run the workflow manually.

The workflow installs Bun, runs `bunx nectar build`, uploads `dist/` as a
debug artifact, installs `flyctl`, and runs:

```sh
flyctl deploy --remote-only
```

Remote builders receive the committed Dockerfile plus the freshly built
`dist/` directory from the Actions workspace.

## Verify the release

After Fly reports a successful release, check the public URL:

```sh
flyctl status
curl -sI https://my-nectar-site.fly.dev/ | sort
curl -sI https://my-nectar-site.fly.dev/404.html | sort
```

For custom domains, add the certificate in Fly first, then update `[site].url`
in `nectar.toml` and rebuild so canonical URLs, feeds, and sitemap entries use
the production hostname.

## Troubleshooting

- **`COPY dist` fails during deploy:** run `bunx nectar build` before
  `flyctl deploy`, or use the GitHub Actions workflow so the build step always
  precedes deployment.
- **Deep pages 404:** confirm the deployed image includes the sample
  `nginx.conf` and that `dist/<slug>/index.html` exists before deploy.
- **Redirects or headers are missing:** `_redirects`, `_headers`, and generated
  nginx config files are host-specific artifacts. Stock nginx ignores them
  unless you translate or mount a compatible config.
- **`brotli_static` breaks nginx startup:** the official `nginx:alpine` image
  may not include the Brotli static module. Use an nginx image with Brotli
  support, or keep the minimal Dockerfile for a plain static runtime.
