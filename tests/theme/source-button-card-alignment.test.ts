import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Regression for backlog task #936: Source only styled the button anchor.
// The card wrapper also needs flex alignment hooks so imported Ghost button
// cards can honor their kg-align-left / kg-align-center modifiers.

const SOURCE_THEME = join(process.cwd(), 'example/themes/source');

async function read(p: string): Promise<string> {
  return await readFile(join(SOURCE_THEME, p), 'utf8');
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('Source theme — button card alignment CSS (#936)', () => {
  test('source screen.css declares wrapper flex alignment fallbacks', async () => {
    const css = await read('assets/css/screen.css');

    expect(ruleBody(css, '.kg-button-card')).toMatch(/display:\s*flex/);
    expect(ruleBody(css, '.kg-button-card.kg-align-left')).toMatch(/justify-content:\s*flex-start/);
    expect(ruleBody(css, '.kg-button-card.kg-align-center')).toMatch(/justify-content:\s*center/);
  });

  test('built screen.css carries the same button alignment selectors', async () => {
    const css = await read('assets/built/screen.css');

    expect(ruleBody(css, '.kg-button-card')).toMatch(/display:flex/);
    expect(ruleBody(css, '.kg-button-card.kg-align-left')).toMatch(/justify-content:flex-start/);
    expect(ruleBody(css, '.kg-button-card.kg-align-center')).toMatch(/justify-content:center/);
  });
});
