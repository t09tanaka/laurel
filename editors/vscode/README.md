# Nectar for Visual Studio Code

VS Code support for editing Nectar projects.

## Features

- Syntax highlighting for `nectar.config.toml` and `nectar.toml`.
- Schema-aware completion for Nectar config keys, backed by the bundled JSON Schema generated from `nectar schema config`.
- Built-in tasks for `nectar build`, `nectar dev`, and `nectar check`.
- A `$nectar` problem matcher for CLI diagnostics such as `---- content/posts/a.md:3:1 - message`.
- Markdown snippets for post, page, tag, and author frontmatter.

## Notes

The bundled schema lives at `schemas/nectar.config.schema.json`. Regenerate it from the repository root with:

```sh
bun src/cli/index.ts schema config > editors/vscode/schemas/nectar.config.schema.json
```
