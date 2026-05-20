# Apache deployment recipe

Use this target when a Ghost migration lands on an existing Apache virtual host
and you want Nectar to generate the Apache rewrite, redirect, cache, and header
rules beside the built site.

## Recipe

1. Set the final `site.url` in `nectar.toml`.
2. Enable Apache output with `[deploy.apache]` in `nectar.toml`.
3. Run `bunx nectar build`.
4. Copy `dist/` to the Apache document root.
5. Confirm the generated `.htaccess` is deployed with the rest of `dist/`.
6. Request a deep page, a missing page, and any migrated Ghost redirect.

## Source docs

- Full guide: [`docs/deploy/apache.md`](../deploy/apache.md)
- Example `.htaccess`: [`examples/deploy/apache/.htaccess`](../../examples/deploy/apache/.htaccess)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
