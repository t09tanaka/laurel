# Deploying Nectar to Fly.io

Fly.io runs applications from container images. Nectar emits static files to
`dist/`, and this repository does not ship a Dockerfile, compose file, or
Fly-specific runtime config. Treat Fly as a small nginx container that serves a
pre-built `dist/` directory.

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

  Keep the generated `fly.toml` in the repo, then review it against the minimal
  static-site example below.

## Minimal Dockerfile

Add this `Dockerfile` at the project root:

```Dockerfile
FROM nginx:alpine
COPY dist /usr/share/nginx/html
```

This image assumes `bunx nectar build` already ran before `flyctl deploy`.
The matching GitHub Actions template at
[`examples/ci/fly.yml`](../../examples/ci/fly.yml) builds `dist/` first, then
lets Fly build and release this small nginx image.

The stock nginx config serves files but does not read Nectar's generated
redirects, security headers, cache headers, pretty-URL fallback, or compression
sidecars. For those production concerns, either copy in a reviewed nginx config
compatible with your image, or use the generated nginx config flow described in
[`docs/deploy/docker.md`](./docker.md#optional-generate-a-nectar-nginx-config).

## Minimal fly.toml

The smallest static-site Fly app listens on port 80 inside the container:

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
2. Add `Dockerfile` and `fly.toml` at the project root.
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
- **Deep pages 404:** the minimal nginx image lacks Nectar's generated
  `try_files $uri $uri/ $uri/index.html =404;` fallback. Use a custom nginx
  config if you need that behavior.
- **Redirects or headers are missing:** `_redirects`, `_headers`, and generated
  nginx config files are host-specific artifacts. Stock nginx ignores them
  unless you translate or mount a compatible config.
- **`brotli_static` breaks nginx startup:** the official `nginx:alpine` image
  may not include the Brotli static module. Use an nginx image with Brotli
  support, or keep the minimal Dockerfile for a plain static runtime.
