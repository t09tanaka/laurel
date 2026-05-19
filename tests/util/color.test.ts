import { describe, expect, test } from 'bun:test';
import { textColorClassFor } from '~/util/color.ts';

describe('textColorClassFor', () => {
  test('returns has-dark-text for light backgrounds', () => {
    expect(textColorClassFor('#ffffff')).toBe('has-dark-text');
    expect(textColorClassFor('#FFF')).toBe('has-dark-text');
    expect(textColorClassFor('#fffe')).toBe('has-dark-text');
    expect(textColorClassFor('rgb(255, 255, 255)')).toBe('has-dark-text');
    expect(textColorClassFor('rgba(240, 240, 240, 0.5)')).toBe('has-dark-text');
    expect(textColorClassFor('white')).toBe('has-dark-text');
  });

  test('returns has-light-text for dark backgrounds', () => {
    expect(textColorClassFor('#000000')).toBe('has-light-text');
    expect(textColorClassFor('#000')).toBe('has-light-text');
    expect(textColorClassFor('#222')).toBe('has-light-text');
    expect(textColorClassFor('rgb(0, 0, 0)')).toBe('has-light-text');
    expect(textColorClassFor('rgb(20% 20% 20%)')).toBe('has-light-text');
    expect(textColorClassFor('black')).toBe('has-light-text');
  });

  test('defaults to has-dark-text for unparseable or missing values', () => {
    expect(textColorClassFor(undefined)).toBe('has-dark-text');
    expect(textColorClassFor(null)).toBe('has-dark-text');
    expect(textColorClassFor('')).toBe('has-dark-text');
    expect(textColorClassFor('not-a-color')).toBe('has-dark-text');
    expect(textColorClassFor('oklch(0.7 0.15 200)')).toBe('has-dark-text');
    expect(textColorClassFor('#zzz')).toBe('has-dark-text');
    expect(textColorClassFor('var(--background-color)')).toBe('has-dark-text');
  });

  test('handles edge cases around the contrast threshold', () => {
    expect(textColorClassFor('#808080')).toBe('has-dark-text');
    expect(textColorClassFor('#777777')).toBe('has-light-text');
  });
});
