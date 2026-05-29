import { join } from 'node:path';
import Handlebars from 'handlebars';
import type { ThemeBundle } from './types.ts';

interface ThemeCompileIssue {
  file: string;
  name: string;
  kind: 'template' | 'partial';
  message: string;
}

// `loadTheme` only reads `.hbs` files as raw strings, so a malformed template
// (unclosed `{{#if}}`, stray `{{/each}}`, etc.) goes undetected until the
// render pipeline picks it up — which `nectar check` never runs. Compile every
// template and partial here to surface Handlebars parse errors up front, with
// the originating file path so the user can jump straight to the offending
// `.hbs`.
export function compileThemeTemplates(theme: ThemeBundle): ThemeCompileIssue[] {
  const issues: ThemeCompileIssue[] = [];
  const hb = Handlebars.create();

  for (const [name, source] of Object.entries(theme.templates)) {
    const message = tryPrecompile(hb, source);
    if (message !== undefined) {
      issues.push({
        file: join(theme.rootDir, `${name}.hbs`),
        name,
        kind: 'template',
        message,
      });
    }
  }

  for (const [name, source] of Object.entries(theme.partials)) {
    const message = tryPrecompile(hb, source);
    if (message !== undefined) {
      issues.push({
        file: join(theme.rootDir, 'partials', `${name}.hbs`),
        name,
        kind: 'partial',
        message,
      });
    }
  }

  return issues;
}

function tryPrecompile(hb: typeof Handlebars, source: string): string | undefined {
  try {
    hb.precompile(source);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
