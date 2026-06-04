# Laurel for Visual Studio Code

VS Code support for editing Laurel projects.

## Features

- Syntax highlighting for `laurel.config.toml` and `laurel.toml`.
- Schema-aware completion for Laurel config keys, backed by the bundled JSON Schema generated from `laurel schema config`.
- Built-in tasks for `laurel build`, `laurel dev`, and `laurel check`.
- A `$laurel` problem matcher for CLI diagnostics such as `---- content/posts/a.md:3:1 - message`.
- Markdown snippets for post, page, tag, and author frontmatter.

## Notes

The bundled schema lives at `schemas/laurel.config.schema.json`. Regenerate it from the repository root with:

```sh
bun src/cli/index.ts schema config > editors/vscode/schemas/laurel.config.schema.json
```
