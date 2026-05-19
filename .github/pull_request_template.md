<!--
Thanks for contributing to Nectar!
Please fill in the sections below so reviewers have the context they need.
-->

## Summary

<!--
What does this PR change, and why?
One or two sentences is fine for small changes. For larger work, list the
notable changes as bullets.
-->

## Test plan

<!--
How did you verify this change? Include the commands you ran and what they
produced. Reviewers will look here to decide what they need to re-run locally.
-->

- [ ] `bun run check` passes
- [ ] `bun test` passes
- [ ] Manual verification against `example/` (describe what you checked)

## Breaking changes

<!--
Tick whichever apply. If you tick any of the "breaking" boxes, describe the
migration story below.
-->

- [ ] No breaking changes
- [ ] Breaking change to the public CLI (`nectar build`, `nectar import-*`, …)
- [ ] Breaking change to `nectar.toml` schema or required config keys
- [ ] Breaking change to the Ghost compatibility surface (helpers, contexts, theme API)
- [ ] Breaking change to the Markdown frontmatter / content layout under `content/`

### Migration notes

<!--
Only required when one of the "breaking" boxes above is ticked.
Explain what users need to do when upgrading.
-->

## Related issues

<!--
Link any related issues, e.g. "Closes #123" or "Refs #456".
-->
