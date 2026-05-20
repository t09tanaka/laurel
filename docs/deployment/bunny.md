# Bunny.net deployment recipe

Use this target when a Ghost migration should be uploaded to a Bunny Storage
Zone and served through a connected Pull Zone.

## Recipe

1. Set `site.url` to the Bunny Pull Zone URL or custom domain.
2. Run `bunx nectar build`.
3. Upload the contents of `dist/` to the Storage Zone.
4. Configure the Pull Zone to serve the uploaded files.
5. Add cache and security headers in Bunny's edge rules or a fronting layer.
6. Check a deep URL, a missing URL, and any imported Ghost redirect.

## Source docs

- Full guide: [`docs/deploy/bunny.md`](../deploy/bunny.md)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
- General hosting notes: [`docs/HOSTING.md`](../HOSTING.md)
