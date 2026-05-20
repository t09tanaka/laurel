# Versioning policy

Nectar follows semantic versioning for the public surfaces documented below.
The current package is `0.x`, so the project is still allowed to refine public
contracts before `1.0.0`, but breaking changes must still be called out
explicitly in the changelog and paired with migration guidance.

When in doubt, treat a change as breaking. Nectar is used by sites, themes,
CI jobs, and plugins that cannot always upgrade in lockstep with the core
package.

## Version lines

### `0.x`

Minor releases may contain breaking changes while Nectar is pre-`1.0.0`.
Those breaks must be deliberate and documented:

- the release notes must include a **Breaking changes** section;
- affected CLI flags, config keys, helper output, or plugin APIs must name the
  old and new forms;
- the migration path must be practical for an existing site or theme;
- patch releases must not introduce intentional breaking changes.

Operators who need stable production builds during `0.x` should pin an exact
version or use a narrow range such as `~0.1.0`, then upgrade intentionally
after reading the release notes.

### `1.x` and later

Starting with `1.0.0`, Nectar uses normal SemVer:

- **Major (`2.0.0`)**: removes or changes a documented public contract.
- **Minor (`1.1.0`)**: adds backwards-compatible functionality.
- **Patch (`1.0.1`)**: fixes bugs without changing documented behaviour.

Downstream packages and sites that want automatic compatible updates should
depend on a single major line, for example `^1.0.0`.

## Public compatibility surface

The public surface is anything a site, theme, plugin, CI job, or package
consumer can reasonably depend on without importing private source files.

### CLI

Covered:

- command names and subcommand names, such as `nectar build`,
  `nectar check`, `nectar theme lint`, and `nectar import-ghost`;
- documented flags, negated flags, positional arguments, and environment
  variable fallbacks from [`docs/cli.md`](./docs/cli.md);
- exit-code semantics for successful runs, usage errors, validation errors,
  and strict-mode failures;
- documented JSON output shapes for commands that support `--json`;
- generated shell completions at the level of command and flag names.

Breaking examples:

- removing or renaming a command, flag, positional argument, or env var;
- changing the type or accepted values of a flag, such as making a boolean
  flag require a string value;
- changing `--json` field names or replacing machine-readable JSON with text;
- changing a default that affects emitted files, validation outcome, or exit
  status for an unchanged project.

Non-breaking examples:

- adding a new command or optional flag;
- adding a new optional field to JSON output;
- improving human-readable log text while preserving JSON output and exit
  behaviour.

### Configuration

Covered:

- `nectar.toml` / `nectar.config.toml` discovery rules;
- documented config keys and value types from [`docs/config.md`](./docs/config.md);
- JSON Schema emitted by `nectar schema config`;
- documented environment and CLI override precedence.

Breaking examples:

- removing, renaming, or moving a config key;
- changing a key's type or units;
- changing a default in a way that changes output, deployed routes, validation,
  caching, sanitisation, or security posture for an unchanged project;
- making a previously valid documented config invalid without a compatibility
  alias or deprecation period.

Non-breaking examples:

- adding an optional key with the previous behaviour as its default;
- accepting an additional spelling or alias while keeping the old key working;
- tightening validation for values that were already outside the documented
  contract.

### Theme helper and template surface

Covered:

- documented Handlebars helpers and block helpers;
- helper parameters, hash arguments, return values, escaping behaviour, and
  `SafeString` versus escaped string semantics;
- root context fields, `@site`, `@config`, `@custom`, `@member`, `@labs`,
  `post`, `page`, `tag`, `author`, `pagination`, and error contexts documented
  in [`docs/THEME_DEV.md`](./docs/THEME_DEV.md),
  [`docs/GHOST_COMPATIBILITY.md`](./docs/GHOST_COMPATIBILITY.md), and
  [`docs/theme-reference.md`](./docs/theme-reference.md);
- route selection and template fallback rules for standard Ghost templates;
- generated HTML hooks that helpers own, such as classes, `data-*` attributes,
  canonical URLs, asset URLs, and card markup that themes style directly.

Breaking examples:

- removing a helper or changing a helper's accepted arguments;
- changing helper output from HTML-safe to escaped text, or the reverse;
- removing a documented context field or changing `null` / `undefined` /
  empty-string behaviour that themes branch on;
- changing route fallback order in a way that makes an existing valid theme
  render a different template;
- changing generated class names or structural HTML for documented helper
  output that themes are expected to style.

Non-breaking examples:

- adding a helper;
- adding an optional context field;
- fixing output to match the documented Ghost-compatible behaviour when the
  old behaviour was a bug;
- adding warnings for unsupported helpers while keeping the build result
  compatible.

### Content API and helper output artifacts

The static Content API has its own field-level contract in
[`docs/api-stability.md`](./docs/api-stability.md). That document is part of
this policy.

Other helper-owned artifacts are covered here, including:

- RSS and sitemap field names and URL semantics that are documented;
- generated deployment helper files when their format is documented for users;
- asset manifest fields;
- machine-readable dry-run, profile, import, export, and check output.

Changing undocumented whitespace, HTML formatting, log wording, cache TTLs
called out as platform-tuned, or file ordering that is explicitly best-effort
is not a breaking change.

### Plugin API

Covered:

- package exports under `nectar/plugin` and documented plugin types;
- hook names, hook order guarantees, hook argument shapes, and allowed return
  values;
- documented helper registration APIs and rendering/build context objects that
  plugins receive;
- TypeScript declaration files published for plugin authors.

Breaking examples:

- removing or renaming an exported type, function, hook, or option;
- changing hook order where the order is documented;
- changing a hook argument from mutable to immutable, or the reverse, when
  plugins can observe it;
- changing thrown error types or structured diagnostics that plugins are told
  to catch.

Non-breaking examples:

- adding a new hook;
- adding an optional property to an existing hook payload;
- adding a new package export while keeping existing exports intact.

## Theme compatibility guarantee

Theme compatibility is pinned to the Nectar major version.

For the `0.x` line, Nectar targets real-world Ghost theme compatibility with
the vendored Source theme as the main compatibility fixture, but the exact
surface may still change in minor releases as the renderer matures.

Starting with `1.0.0`, a Ghost-style theme that:

- uses documented helpers, partials, contexts, and template fallback rules;
- passes `nectar theme lint` and `nectar check` on the same major line;
- does not depend on private files in `src/` or undocumented generated markup;
- does not require a Ghost server runtime feature that Nectar documents as out
  of scope, such as Members sessions, Admin API writes, or dynamic Portal
  POST handlers;

is expected to keep rendering across all releases in that major line. For
example, a theme that works on `1.0.0` should keep working on `1.7.0`.
Breaking that guarantee requires the next major release.

Each major line may raise the supported Ghost compatibility target. When that
happens, the release notes must name the affected helpers, context fields,
theme package keys, card markup, or runtime assumptions, and provide a
migration path for theme authors.

## Deprecation policy

After `1.0.0`, removals should go through a deprecation period whenever the
old behaviour can be kept safely:

1. Add the replacement and keep the old path working.
2. Emit a clear warning from `nectar check`, `nectar theme lint`, or the
   relevant command.
3. Document the removal target in the changelog.
4. Remove the deprecated path only in the next major release.

Security fixes, data-loss fixes, and fixes for behaviour that was never
documented may skip the full deprecation period, but the release notes must
explain why.

## Migration guidance

Before upgrading across a breaking release:

1. Read the changelog entry for **Breaking changes** and **Deprecations**.
2. Update the installed version deliberately (`~0.x.y` during `0.x`, or the
   next major range after `1.0.0`).
3. Run `nectar check --strict`.
4. Run `nectar theme lint <path-to-theme>` for each custom theme.
5. Rebuild with `nectar build` and inspect representative pages, generated
   JSON, RSS, sitemap, and deployment helper files that your site consumes.
6. For plugins, run the plugin's typecheck and test suite against the new
   `nectar/plugin` types.

Sites with custom themes should keep a small golden build or visual snapshot
for the home page, a post, a page, a tag archive, an author archive, and any
custom card or helper-heavy template. That catches compatibility breaks faster
than comparing an entire `dist/` tree by hand.
