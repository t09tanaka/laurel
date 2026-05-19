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
- Renovate (see `.github/renovate.json`) opens grouped weekly PRs for both
  npm and GitHub Actions ecosystems, so updates are reviewed by a human
  rather than picked up at install time. `handlebars` and `marked` major
  bumps are split into their own PRs because they have historically broken
  Ghost theme compatibility or Markdown sanitization. Renovate is preferred
  over Dependabot here because it understands `bun.lock` natively.
- Maintainers run `bun audit` (or an equivalent scanner) against the
  lockfile when triaging dependency PRs and before tagging a release.
- CI runs four automated scans on every push and PR to `main`, plus a
  weekly schedule, via [`.github/workflows/security.yml`](.github/workflows/security.yml):
  [gitleaks](https://github.com/gitleaks/gitleaks) for secrets in commit
  history, [osv-scanner](https://github.com/google/osv-scanner) against
  `bun.lock`, `bun audit` for bun-native advisories paired with a
  `bun install --frozen-lockfile` step that re-verifies tarball hashes
  against the committed lockfile, and [CodeQL](https://codeql.github.com/)
  for the JavaScript/TypeScript source. Contributors can opt in to a local
  gitleaks pre-commit hook — see
  [`CONTRIBUTING.md` § Secrets scanning](CONTRIBUTING.md#secrets-scanning).

If you find a vulnerable transitive dependency that the above process missed,
please report it through the channels in
[Reporting a Vulnerability](#reporting-a-vulnerability).

## Bug bounty and recognition

Nectar is an unfunded open-source project, so **no monetary bounty is
currently offered**. We do recognize researchers in three ways that cost
nothing and are useful for your portfolio:

- **Credit in the GitHub Security Advisory** (and any CVE we request) under
  the name and contact you choose, or anonymously on request.
- **Mention in the release notes / `CHANGELOG.md`** for the version that
  ships the fix.
- **A thank-you entry in this file** for reports that result in a
  non-trivial hardening change.

### Criteria for a future paid program

If this project finds funding (sponsorship, grant, or employer underwrite),
we intend to offer modest monetary bounties via
[huntr.dev](https://huntr.dev/) or direct payment, calibrated by severity
(CVSS v3.1):

| Severity            | Indicative floor     |
| ------------------- | -------------------- |
| Critical (9.0–10.0) | $100                 |
| High (7.0–8.9)      | $50                  |
| Medium (4.0–6.9)    | Discretionary / swag |
| Low (0.1–3.9)       | Recognition only     |

These are floors, not ceilings — particularly creative supply-chain or
sandbox-escape findings will be rewarded above the floor.

Eligibility (when the program goes live):

- First reporter of a **confirmed, previously-unknown** issue **in
  [Scope](#scope)**.
- Reported through a **private channel** listed in
  [Reporting a Vulnerability](#reporting-a-vulnerability) — public issues,
  discussions, or PRs disqualify the report.
- Not a duplicate of an existing internal finding or open advisory.
- Reporter follows [Safe Harbor](#safe-harbor) rules (no privacy
  violations, data destruction, or service disruption).
- One bounty per root cause, regardless of how many entry points it has.

Until the program is funded, reports are still very welcome — the
recognition above applies today, and reports submitted now remain eligible
for retroactive payment if a paid program launches before the issue is
publicly disclosed.

## Safe Harbor

We will not pursue or support legal action against researchers who:

- Make a good-faith effort to follow this policy.
- Avoid privacy violations, destruction of data, and disruption of services.
- Give us a reasonable window to fix the issue before public disclosure.

Thank you for helping keep Nectar safe.
