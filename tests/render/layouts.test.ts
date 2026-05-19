import { describe, expect, test } from 'bun:test';
import { splitLayout } from '~/render/layouts.ts';

describe('splitLayout', () => {
  test('extracts the layout directive and returns the rest of the template', () => {
    const tpl = `{{!< default}}\n<main>Hi</main>`;
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBe('default');
    expect(body.trim()).toBe('<main>Hi</main>');
  });

  test('returns undefined layout when no directive', () => {
    const tpl = `<main>Hi</main>`;
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBeUndefined();
    expect(body).toBe('<main>Hi</main>');
  });

  test('tolerates surrounding whitespace and comments after directive', () => {
    const tpl = `{{!< default}}\n{{!-- a comment --}}\n<main></main>`;
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBe('default');
    expect(body.startsWith('{{!--')).toBeTrue();
  });
});
