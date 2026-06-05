# Deploying Laurel with Docker

Laurel is a build-time CLI distributed on npm; there is no official Laurel
container image. Run `laurel build` with `bunx laurel build` (or `npm i -g
laurel`), then serve the generated static `dist/` directory from a container.
This page covers the nginx-based hosting samples Laurel ships for that purpose.

Laurel ships two nginx-alpine samples under
[`examples/docker/`](../../examples/docker/):
[`Dockerfile`](../../examples/docker/Dockerfile) serves an already-built
`dist/`, while
[`Dockerfile.multi-stage`](../../examples/docker/Dockerfile.multi-stage)
runs `bun install` and `bunx laurel build` in an `oven/bun` build stage before
copying `dist/` into an `nginx:1.27-alpine` runtime image. Both use the
matching [`nginx.conf`](../../examples/docker/nginx.conf). The multi-stage
sample also pairs with
[`examples/docker/.dockerignore`](../../examples/docker/.dockerignore) to keep
local-only directories out of the Docker build context. A reverse-proxy compose
snippet is available at
[`docker-compose.yml`](../../examples/docker/docker-compose.yml). Laurel still
does not require Docker-specific package scripts.

## Quickstart: local nginx container

1. Build the site on the host:

   ```sh
   bunx laurel build
   ```

2. Serve the generated `dist/` directory with the stock nginx image:

   ```sh
   docker run --rm \
     --name laurel-static \
     -p 8080:80 \
     -v "$PWD/dist:/usr/share/nginx/html:ro" \
     nginx:alpine
   ```

3. Open `http://localhost:8080/` and verify built pages:

   ```sh
   curl -sI http://localhost:8080/ | sort
   curl -sI http://localhost:8080/404.html | sort
   ```

This path is intentionally minimal: it proves the static output serves from a
container, but it uses nginx's default config. That means Laurel's generated
cache headers, security headers, pretty-URL fallback, and redirects are not
applied unless you add an nginx config.

## Build the sample image

The checked-in sample is for hosts that require a Dockerfile but do not need to
build the Laurel site inside the image. Build the site first, then copy the
sample files into the build context:

```sh
bunx laurel build
cp examples/docker/Dockerfile .
cp examples/docker/nginx.conf .
docker build -t laurel-static .
docker run --rm --name laurel-static -p 8080:80 laurel-static
```

The Dockerfile uses `nginx:1.27-alpine`, copies `dist/` into
`/usr/share/nginx/html/`, installs the sample nginx config, and exposes port
80. The sample config keeps directory-style pretty URLs working with
`try_files $uri $uri/ $uri/index.html =404;` and serves Laurel's generated
`404.html` through `error_page 404 /404.html;`.

## Build the site inside Docker

Use the multi-stage sample when your platform expects Docker to install
dependencies and produce `dist/` during `docker build`:

```sh
cp examples/docker/Dockerfile.multi-stage Dockerfile
cp examples/docker/nginx.conf .
cp examples/docker/.dockerignore .dockerignore
docker build -t laurel-static .
docker run --rm --name laurel-static -p 8080:80 laurel-static
```

The first stage starts from `oven/bun`, copies the site source, installs
dependencies with `bun install`, and runs `bunx laurel build`. The final
`nginx:1.27-alpine` stage contains only the sample nginx config and the
generated `/app/dist/` files, so build tools and source files do not ship in
the runtime layer. The sample `.dockerignore` excludes `.git/`, `node_modules/`,
and any host-built `dist/` from the build context; do not copy it for the
single-stage `Dockerfile` unless you remove `dist/` from the ignore list.

## Run behind Traefik or Caddy with compose

Use the compose sample when a reverse proxy should route traffic to the nginx
container over a shared Docker network:

```sh
cp examples/docker/Dockerfile.multi-stage Dockerfile.multi-stage
cp examples/docker/nginx.conf nginx.conf
cp examples/docker/docker-compose.yml docker-compose.yml
docker network create proxy
docker compose up -d --build
```

The sample builds with `Dockerfile.multi-stage`, exposes nginx port `80` to
the `proxy` network, includes Traefik labels for `blog.example.com`, and keeps
`127.0.0.1:8080:80` for local smoke tests or a host-level Caddy proxy. Change
the hostname and network name to match your proxy stack. For a Caddy container
on the same network, point the site block at `reverse_proxy laurel:80`.

## Optional: generate a Laurel nginx config

For a Docker runtime that mirrors Laurel's self-hosted nginx behavior, enable
the nginx deploy target before building:

```toml
# laurel.toml
[deploy.nginx]
enabled = true
root = "/var/www/laurel"
server_name = "_"
```

Then build:

```sh
bunx laurel build
test -f dist/.laurel/nginx.conf
```

The generated file folds `deploy.headers` and `redirects.yaml` into an nginx
`server { ... }` block and expects the site files at `root`. If your nginx
image supports both `gzip_static` and `brotli_static`, mount the generated
config over nginx's default site config and mount `dist/` at the same root:

```sh
docker run --rm \
  --name laurel-nginx \
  -p 8080:80 \
  -v "$PWD/dist:/var/www/laurel:ro" \
  -v "$PWD/dist/.laurel/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  your-nginx-brotli-image:tag
```

The official `nginx:alpine` image supports `gzip_static`, but may not include
the Brotli module needed for `brotli_static`. If the container exits with an
`unknown directive "brotli_static"` error, either use an nginx image that
loads the Brotli static module or keep the minimal stock-config command above
for local smoke tests.

## Minimal Dockerfile for platforms that require one

Some hosts, such as Fly.io, expect a Dockerfile even for static content.
You can copy the sample files from
[`examples/docker/`](../../examples/docker/) after CI has already run
`bunx laurel build`:

```Dockerfile
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
```

That Dockerfile applies the sample `examples/docker/nginx.conf`, which covers
pretty URLs, `404.html`, long-lived cache headers for asset directories, and
short-lived cache headers for HTML. For production deployments that need
redirects, custom security headers, or a different document root, generate and
review `dist/.laurel/nginx.conf` from `[deploy.nginx]` instead.

For a Fly.io-specific workflow, including the matching `fly.toml` shape and
GitHub Actions setup, see [`docs/deploy/fly.md`](./fly.md).

## Redirects, headers, and compression

- `redirects.yaml` is always emitted to `dist/_redirects` by the default
  redirects component, but nginx does not read that file. Enable
  `[deploy.nginx]` when you want redirects translated into nginx `location`
  rules.
- Cache and security headers come from `[deploy.headers]`. The generated nginx
  config repeats those headers inside each `location` because nginx
  `add_header` directives do not inherit once a location defines its own
  headers.
- `[build].precompress = true` emits `.br` and `.gz` sidecars. nginx only
  serves them when the runtime config and image support the matching static
  compression directives.

## Troubleshooting

- **Container starts but every deep page 404s:** the stock nginx config does
  not include Laurel's `try_files $uri $uri/ $uri/index.html =404;` fallback.
  Enable `[deploy.nginx]` and use an nginx image compatible with the generated
  config, or add an equivalent custom config.
- **`brotli_static` fails:** use an nginx image with the Brotli static module,
  or remove that directive from your own copied config. Do not edit
  `dist/.laurel/nginx.conf` in place as a long-term source of truth; regenerate
  it from `laurel.toml`.
- **No Docker command in `package.json`:** this is expected. Use
  `bunx laurel build` or the existing `build` script, then run Docker against
  the resulting `dist/` directory, or use
  `examples/docker/Dockerfile.multi-stage` when the image build should run
  `bunx laurel build` itself.
