# Getting Help

Nectar uses **GitHub Discussions** as the community forum and **GitHub Issues**
as the bug / feature tracker. Picking the right venue gets you a faster, more
useful answer and keeps the issue tracker scannable.

> **Note**
> Discussions must be enabled in the repository settings for the links below
> to resolve. If you land on a 404, ping a maintainer and we'll flip the toggle.

## Where to go

| You want to…                                                  | Use this                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ask "how do I…?" or "why does Nectar…?"                       | [Discussions → Q&A](https://github.com/t09tanaka/nectar/discussions/categories/q-a)   |
| Show off a site you built / a custom theme                    | [Discussions → Show and tell](https://github.com/t09tanaka/nectar/discussions/categories/show-and-tell) |
| Propose a feature or bounce an idea before writing code       | [Discussions → Ideas](https://github.com/t09tanaka/nectar/discussions/categories/ideas) |
| Read announcements (releases, breaking changes, deprecations) | [Discussions → Announcements](https://github.com/t09tanaka/nectar/discussions/categories/announcements) |
| Report a reproducible bug                                     | [Open an issue](https://github.com/t09tanaka/nectar/issues/new/choose)                |
| Report a security vulnerability                               | See [`SECURITY.md`](../SECURITY.md) — **do not** open a public issue                  |

## Why two venues

The issue tracker is the maintainer's working queue: every open issue is
something a maintainer is on the hook to triage, reproduce, and close. Treating
it as the catch-all for usage questions buries real bugs under "how do I…" and
makes triage painful.

Discussions is conversational. Threads can stay open, accumulate answers, and
get marked with the accepted reply. Other users find them later via search.

Concretely:

- **Bug:** Nectar throws / produces wrong output for a specific input you can
  pin down → **issue** (with a minimal reproduction).
- **Question:** You're not sure how something is supposed to work, or whether
  your config is correct → **Discussion → Q&A**.
- **Feature idea:** You think Nectar should do X → **Discussion → Ideas**
  first. If it gets traction, a maintainer or you open an issue to track the
  implementation.

## Response expectations

This is a small project. Responses are best-effort, not SLA-backed. A few
heuristics:

- Discussions with a minimal, runnable repro get answered quickest.
- Bug reports that include the Nectar version, Bun version, theme name, and a
  trimmed `nectar.toml` save back-and-forth.
- "Bumping" threads more than once a week usually slows things down rather
  than speeding them up — maintainers see new activity in the same place
  either way.

If a thread is genuinely stuck and you think we missed it, mention
`@t09tanaka` once. We'd rather be pinged than have you wait silently.
