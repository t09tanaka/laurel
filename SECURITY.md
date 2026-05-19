# Security Policy

Thanks for helping keep Nectar and its users safe. This document explains how to
report a vulnerability in Nectar (the Ghost-compatible static site generator in
this repository) and what to expect after you do.

## Supported Versions

Nectar is pre-1.0 and ships from `main`. Security fixes land on `main` and the
latest published release on npm. Older versions are not patched separately —
please upgrade to the latest release.

| Version       | Supported          |
| ------------- | ------------------ |
| latest `main` | :white_check_mark: |
| latest npm    | :white_check_mark: |
| older         | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.** Public disclosure before a fix is available
puts other users at risk.

Instead, use one of the private channels below.

### Preferred: GitHub Security Advisories

Open a private vulnerability report through GitHub's built-in flow:

1. Go to <https://github.com/t09tanaka/nectar/security/advisories/new>.
2. Fill in the advisory form with as much detail as you can share.
3. Submit. Only repository maintainers will be able to see the report.

This is the fastest path because it keeps the report, the discussion, and the
eventual fix linked in one place, and lets us request a CVE if appropriate.

### Alternative: Email

If you cannot use GitHub Security Advisories, email **t09tanaka@gmail.com**
with the subject line `[nectar security] <short summary>`.

## What to Include

A good report makes triage much faster. Where possible, please include:

- A clear description of the issue and its impact.
- The affected version, commit SHA, or release tag.
- Steps to reproduce (a minimal repo or theme that triggers it is ideal).
- Proof-of-concept input, payload, or command, if applicable.
- Any known mitigations or workarounds.
- Whether the issue is already public anywhere.

## What to Expect

- **Acknowledgement** within 5 business days of receipt.
- **Initial assessment** (valid / not-a-vuln / needs-more-info) within 10
  business days.
- **Status updates** at least every 14 days while the issue is open.
- **Fix and disclosure** coordinated with you. We aim to ship a fix and a
  public advisory within 90 days of a confirmed report, sooner for actively
  exploited issues.

We are a small project, so timing can slip on weekends and holidays — if you
have not heard back within the windows above, please send a polite nudge.

## Scope

In scope:

- The Nectar CLI and library code under `src/`.
- The build pipeline that turns Markdown content and Ghost themes into a
  static site.
- The example site under `example/` _only_ where it demonstrates a Nectar
  behavior (not third-party Ghost theme code vendored verbatim).

Out of scope:

- Vulnerabilities in third-party Ghost themes vendored for testing (e.g.
  `example/themes/source/`). Please report those upstream to the theme
  authors.
- Issues that require an attacker to already have write access to your
  `content/` directory or theme files — these are trust boundaries Nectar
  does not defend.
- Denial of service from intentionally pathological input to the local CLI
  (e.g. multi-GB Markdown files). Reports are still welcome, but will be
  treated as bugs rather than security issues unless they enable code
  execution or data exfiltration.

## Trust model for frontmatter fields

A handful of frontmatter fields let an author splice raw HTML / JS into the
rendered site. These bypass Markdown sanitization by design, so anyone with
write access to `content/` (including PR contributors before merge) can ship
site-wide script if they are enabled. They are gated behind explicit opt-in
config so the default build is safe even when accepting outside PRs:

- `codeinjection_head` / `codeinjection_foot` on posts and pages — ignored
  unless `build.allow_code_injection = true` is set in `nectar.toml`. The
  loader logs a warning when it drops these fields so the misconfiguration is
  visible at build time.
- `unsafe_html: true` on a single post / page — disables the HTML sanitizer
  for that file's Markdown body. Apply only to files you trust.

If you enable either flag, treat PRs that touch `codeinjection_*` /
`unsafe_html` (or files with those fields set) as code review for raw HTML/JS
shipped to every visitor.

## Hosting headers

The built site is plain static files, so HTTP response headers
(`Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`,
`Permissions-Policy`, …) are set by the hosting platform, not by Nectar.
See [`docs/security/hosting.md`](docs/security/hosting.md) for
copy-pasteable `_headers` / `vercel.json` / `netlify.toml` snippets
calibrated to what Nectar actually emits (inline JSON-LD, optional
component scripts, theme-controlled inline scripts), plus workarounds for
GitHub Pages' fixed header set.

## Dependency hygiene

Markdown and template parsing libraries (notably `marked`) have a history of
ReDoS issues that ship in transitive patch releases. To keep these from
landing silently:

- Runtime dependencies that parse untrusted content are **pinned to an exact
  version** in `package.json` (no `^` or `~` range). `marked` is the current
  example; future parsers should follow the same rule.
- Dependabot (see `.github/dependabot.yml`) opens grouped weekly PRs for both
  npm and GitHub Actions ecosystems, so updates are reviewed by a human
  rather than picked up at install time.
- Maintainers run `bun pm audit` (or an equivalent scanner) against the
  lockfile when triaging dependency PRs and before tagging a release.

If you find a vulnerable transitive dependency that the above process missed,
please report it through the channels in
[Reporting a Vulnerability](#reporting-a-vulnerability).

## Safe Harbor

We will not pursue or support legal action against researchers who:

- Make a good-faith effort to follow this policy.
- Avoid privacy violations, destruction of data, and disruption of services.
- Give us a reasonable window to fix the issue before public disclosure.

Thank you for helping keep Nectar safe.
