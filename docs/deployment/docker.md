# Docker deployment recipe

Use this target when you want to build a site with the published Nectar image
or package a prebuilt Nectar `dist/` directory behind nginx in a container.

## Recipe

1. Set `site.url` and any required `build.base_path`.
2. Build with `docker run --rm -v "$PWD:/workspace" ghcr.io/t09tanaka/nectar:latest`,
   or run `bunx nectar build` on the host.
3. To serve the output from a container, choose the single-stage or multi-stage Docker sample.
4. Copy the sample Dockerfile and nginx config into the site repository.
   If you run behind Traefik or Caddy, also copy
   `examples/docker/docker-compose.yml`.
5. Build and run the image locally before pushing it to a registry.
6. Verify a deep page, static assets, 404s, and migrated redirects.

## Source docs

- Full guide: [`docs/deploy/docker.md`](../deploy/docker.md)
- Docker examples: [`examples/docker/`](../../examples/docker/)
- nginx recipe: [`nginx.md`](./nginx.md)
