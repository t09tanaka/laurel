import { describe, expect, test } from 'bun:test';
import { resolveLayoutName, splitLayout } from '~/render/layouts.ts';

describe('splitLayout', () => {
  test('extracts the layout directive and returns the rest of the template', () => {
    const tpl = '{{!< default}}\n<main>Hi</main>';
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBe('default');
    expect(body.trim()).toBe('<main>Hi</main>');
  });

  test('returns undefined layout when no directive', () => {
    const tpl = '<main>Hi</main>';
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBeUndefined();
    expect(body).toBe('<main>Hi</main>');
  });

  test('tolerates surrounding whitespace and comments after directive', () => {
    const tpl = '{{!< default}}\n{{!-- a comment --}}\n<main></main>';
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBe('default');
    expect(body.startsWith('{{!--')).toBeTrue();
  });

  test('extracts relative layout paths', () => {
    const tpl = '{{!< ../default-wide}}\n<main>Account</main>';
    const { layout, body } = splitLayout(tpl);
    expect(layout).toBe('../default-wide');
    expect(body.trim()).toBe('<main>Account</main>');
  });
});

describe('resolveLayoutName', () => {
  test('keeps root layout names unchanged', () => {
    expect(resolveLayoutName('default-wide', 'members/account')).toBe('default-wide');
  });

  test('resolves parent layout paths relative to the template path', () => {
    expect(resolveLayoutName('../default-wide', 'members/account')).toBe('default-wide');
  });

  test('resolves sibling layout paths relative to the template path', () => {
    expect(resolveLayoutName('./account-wide', 'members/account')).toBe('members/account-wide');
  });
});
