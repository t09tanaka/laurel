# Fly.io deployment recipe

Use this target when you want Fly.io to run a small nginx app that serves a
prebuilt Nectar `dist/` directory.

## Recipe

1. Set the production `site.url`.
2. Enable nginx output when you need generated redirects or headers.
3. Run `bunx nectar build`.
4. Copy the Fly examples for `fly.toml`, Dockerfile, and nginx config as
   needed.
5. Create the Fly app with `flyctl launch --no-deploy`.
6. Deploy, then verify deep routes, static assets, 404s, and redirects.

## Source docs

- Full guide: [`docs/deploy/fly.md`](../deploy/fly.md)
- Fly examples: [`examples/fly/`](../../examples/fly/)
- CI example: [`examples/ci/fly.yml`](../../examples/ci/fly.yml)
