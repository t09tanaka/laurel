import { describe, expect, test } from 'bun:test';
import {
  THEME_SCOPE_CLASS,
  rewriteThemeCss,
} from '../../../src/cli/dashboard/theme-css-rewriter.ts';

const SCOPE = `.${THEME_SCOPE_CLASS}`;

describe('rewriteThemeCss', () => {
  test('prefixes ordinary class selectors with the scope', () => {
    const out = rewriteThemeCss('.kg-bookmark-card { color: red; }');
    expect(out).toContain(`${SCOPE} .kg-bookmark-card`);
  });

  test('maps :root onto the scope element so CSS variables apply inside it', () => {
    const out = rewriteThemeCss(':root { --x: 1; }');
    // Theme variables must land on the scope, not on the document root.
    expect(out).toContain(`${SCOPE} {`);
    expect(out).toContain('--x: 1');
    expect(out).not.toContain(':root');
  });

  test('rewrites html / body onto the scope element', () => {
    const out = rewriteThemeCss('html { font-size: 62.5%; } body { background: #fff; }');
    expect(out).toMatch(new RegExp(`${escapeRegex(SCOPE)} \\{\\s*font-size`));
    expect(out).toMatch(new RegExp(`${escapeRegex(SCOPE)} \\{\\s*background`));
    expect(out).not.toMatch(/(^|[^.])html\s*\{/);
    expect(out).not.toMatch(/(^|[^.])body\s*\{/);
  });

  test('attaches modifiers on :root / html / body to the scope class', () => {
    const out = rewriteThemeCss(':root.has-light-text { --x: 2; } html.dark { color: #fff; }');
    expect(out).toContain(`${SCOPE}.has-light-text`);
    expect(out).toContain(`${SCOPE}.dark`);
  });

  test('keeps the universal reset scoped to descendants of the scope', () => {
    const out = rewriteThemeCss('* { box-sizing: border-box; }');
    expect(out).toContain(`${SCOPE} *`);
  });

  test('expands the common reset triple (*,:after,:before) into descendants', () => {
    const out = rewriteThemeCss('*,:after,:before { box-sizing: border-box; }');
    expect(out).toContain(`${SCOPE} *`);
    expect(out).toContain(`${SCOPE} *::after`);
    expect(out).toContain(`${SCOPE} *::before`);
  });

  test('honours a custom scope name', () => {
    const out = rewriteThemeCss('.kg-bookmark-card { color: red; }', { scope: 'custom' });
    expect(out).toContain('.custom .kg-bookmark-card');
  });

  test('leaves at-rules like @font-face untouched (they cannot be scoped)', () => {
    const out = rewriteThemeCss(
      "@font-face { font-family: 'X'; src: url('x.woff2'); } .kg-bookmark-card { color: red; }",
    );
    expect(out).toContain('@font-face');
    expect(out).toContain("font-family: 'X'");
    expect(out).toContain(`${SCOPE} .kg-bookmark-card`);
  });

  test('preserves @media nesting', () => {
    const out = rewriteThemeCss('@media (min-width: 700px) { .kg-bookmark-card { color: red; } }');
    expect(out).toContain('@media (min-width: 700px)');
    expect(out).toContain(`${SCOPE} .kg-bookmark-card`);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
