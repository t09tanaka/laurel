# Tutorials

Short, copy-pasteable walkthroughs. Each one is self-contained and ends with
something running locally. Pick the one that matches what you are trying to do.

| #   | Tutorial                                                          | You finish with                                                       |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | [Start a blog from scratch](./01-start-a-blog.md)                 | A brand-new blog running locally, with one post and the Source theme. |
| 2   | [Migrate from Ghost in 10 minutes](./02-migrate-from-ghost.md)    | Your existing Ghost export rendered as a static Nectar site.          |
| 3   | [Customise the Source theme](./03-customise-source-theme.md)      | Branding, navigation, layout tweaks against the vendored theme.       |
| 4   | [Deploy to Cloudflare / Vercel / Netlify / Firebase Hosting / Render / GitHub Pages](./04-deploy.md) | Your `dist/` shipping on the host of your choice.      |
| 5   | [Write your first plugin](./05-write-your-first-plugin.md)        | A typed plugin module plus the working extension points today.        |

**Prerequisites for every tutorial:** [Bun](https://bun.sh) ≥ 1.3 (`bun --version`)
and a recent Git. Nectar is invoked through `bunx nectar` — no global install
is required.

If you get stuck, run `bunx nectar doctor` for a health check, or open an
issue. The companion references are
[`docs/DESIGN.md`](../DESIGN.md),
[`docs/THEME_DEV.md`](../THEME_DEV.md), and
[`docs/GHOST_COMPATIBILITY.md`](../GHOST_COMPATIBILITY.md).
