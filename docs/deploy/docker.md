# Deploying Nectar with Docker

Nectar does not ship a Dockerfile, docker-compose file, or Docker-specific
package script today. The build output is still easy to run in Docker because
`nectar build` emits plain static files under `dist/`. Treat Docker as the
runtime wrapper around that already-built directory.

## Quickstart: local nginx container

1. Build the site on the host:

   ```sh
   bunx nectar build
   ```

2. Serve the generated `dist/` directory with the stock nginx image:

   ```sh
   docker run --rm \
     --name nectar-static \
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
container, but it uses nginx's default config. That means Nectar's generated
cache headers, security headers, pretty-URL fallback, and redirects are not
applied unless you add an nginx config.

## Optional: generate a Nectar nginx config

For a Docker runtime that mirrors Nectar's self-hosted nginx behavior, enable
the nginx deploy target before building:

```toml
# nectar.toml
[deploy.nginx]
enabled = true
root = "/var/www/nectar"
server_name = "_"
```

Then build:

```sh
bunx nectar build
test -f dist/.nectar/nginx.conf
```

The generated file folds `deploy.headers` and `redirects.yaml` into an nginx
`server { ... }` block and expects the site files at `root`. If your nginx
image supports both `gzip_static` and `brotli_static`, mount the generated
config over nginx's default site config and mount `dist/` at the same root:

```sh
docker run --rm \
  --name nectar-nginx \
  -p 8080:80 \
  -v "$PWD/dist:/var/www/nectar:ro" \
  -v "$PWD/dist/.nectar/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  your-nginx-brotli-image:tag
```

The official `nginx:alpine` image supports `gzip_static`, but may not include
the Brotli module needed for `brotli_static`. If the container exits with an
`unknown directive "brotli_static"` error, either use an nginx image that
loads the Brotli static module or keep the minimal stock-config command above
for local smoke tests.

## Minimal Dockerfile for platforms that require one

Some hosts, such as Fly.io, expect a Dockerfile even for static content.
Nectar does not provide one in the repo, but a deploy-specific project can add
this minimal runtime image after CI has already run `bunx nectar build`:

```Dockerfile
FROM nginx:alpine
COPY dist /usr/share/nginx/html
```

That Dockerfile has the same limitation as the local quickstart: it serves the
files but does not apply Nectar's generated nginx headers or redirects. For a
production container, copy in a reviewed nginx config that matches your image's
available modules.

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
  not include Nectar's `try_files $uri $uri/ $uri/index.html =404;` fallback.
  Enable `[deploy.nginx]` and use an nginx image compatible with the generated
  config, or add an equivalent custom config.
- **`brotli_static` fails:** use an nginx image with the Brotli static module,
  or remove that directive from your own copied config. Do not edit
  `dist/.nectar/nginx.conf` in place as a long-term source of truth; regenerate
  it from `nectar.toml`.
- **No Docker command in `package.json`:** this is expected. Use
  `bunx nectar build` or the existing `build` script, then run Docker against
  the resulting `dist/` directory.
