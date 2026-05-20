# Deploying Nectar to Fly.io

Fly.io runs applications from container images. Nectar emits static files to
`dist/`, and the sample under [`examples/fly/`](../../examples/fly/) treats Fly
as a small nginx container that serves that pre-built directory.

Use this guide when you want Fly's app platform, regions, TLS, and rollout
model for a static Nectar site. If you only need to smoke-test the container
locally, start with [`docs/deploy/docker.md`](./docker.md).

## Prerequisites

- The nginx deploy target enabled with Fly's container document root:

  ```toml
  # nectar.toml
  [deploy.nginx]
  enabled = true
  root = "/usr/share/nginx/html"
  server_name = "_"
  ```

- A working Nectar build that emits the generated nginx config:

  ```sh
  bunx nectar build
  test -d dist
  test -f dist/.nectar/nginx.conf
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

## Generated nginx sample

Copy the Fly sample runtime files to the project root:

```sh
cp examples/fly/fly.toml fly.toml
cp examples/fly/Dockerfile Dockerfile
```

The sample [`Dockerfile`](../../examples/fly/Dockerfile) assumes
`bunx nectar build` already ran before `flyctl deploy`. It copies
`dist/.nectar/nginx.conf` to `/etc/nginx/conf.d/default.conf`, then copies
`dist/` to `/usr/share/nginx/html/`. That generated config is the same shared
nginx emitter used by the self-hosted nginx guide, so `redirects.yaml` and
`[deploy.headers]` become nginx `location`, `return`, and `add_header` rules
inside the Fly image.

The generated config includes `brotli_static on;` for nginx builds that ship
the Brotli static module. The sample image uses stock `nginx:1.27-alpine`, so
the Dockerfile removes only that directive during image build. Use a
Brotli-enabled nginx image and remove that `sed` line if you want `.br`
sidecars served directly.

The checked-in [`examples/fly/nginx.conf`](../../examples/fly/nginx.conf) is a
static-only fallback for projects that intentionally do not enable
`[deploy.nginx]`. Do not use that fallback when you expect generated redirects,
cache headers, or security headers to apply on Fly.

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
2. Enable `[deploy.nginx]` with `root = "/usr/share/nginx/html"` in
   `nectar.toml`.
3. Copy [`examples/fly/fly.toml`](../../examples/fly/fly.toml) and
   [`examples/fly/Dockerfile`](../../examples/fly/Dockerfile) to the project
   root. Keep [`examples/fly/nginx.conf`](../../examples/fly/nginx.conf) only
   as the static-only fallback reference.
4. Create a Fly API token:

   ```sh
   flyctl auth token
   ```

5. Store it as the repository secret `FLY_API_TOKEN`.
6. Push to `main` or run the workflow manually.

The workflow installs Bun, runs `bunx nectar build`, uploads `dist/` as a
debug artifact, installs `flyctl`, and runs:

```sh
flyctl deploy --remote-only
```

Remote builders receive the committed Dockerfile plus the freshly built
`dist/` directory from the Actions workspace, including
`dist/.nectar/nginx.conf`.

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

- **`COPY dist/.nectar/nginx.conf` fails during deploy:** enable
  `[deploy.nginx]`, set `root = "/usr/share/nginx/html"`, and run
  `bunx nectar build` before `flyctl deploy`. The GitHub Actions workflow keeps
  that build step before deployment.
- **Deep pages 404:** confirm the deployed image uses the generated
  `/etc/nginx/conf.d/default.conf` and that `dist/<slug>/index.html` exists
  before deploy.
- **Redirects or headers are missing:** confirm Fly is using
  `dist/.nectar/nginx.conf`, not the static-only `examples/fly/nginx.conf`
  fallback. Stock nginx ignores `_redirects` and `_headers`.
- **`brotli_static` breaks nginx startup:** keep the sample Dockerfile's
  `sed -i '/brotli_static/d' ...` line when using stock `nginx:alpine`, or
  switch to an nginx image that loads the Brotli static module.
