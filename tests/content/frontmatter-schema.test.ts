import { describe, expect, test } from 'bun:test';
import {
  frontmatterStatusValues,
  pageFrontmatterStatusValues,
} from '~/content/frontmatter-schema.ts';

describe('frontmatterStatusValues', () => {
  test('contains standard statuses', () => {
    expect(frontmatterStatusValues).toContain('published');
    expect(frontmatterStatusValues).toContain('draft');
    expect(frontmatterStatusValues).toContain('scheduled');
  });

  test('contains needs-review', () => {
    expect(frontmatterStatusValues).toContain('needs-review');
  });

  test('contains approved', () => {
    expect(frontmatterStatusValues).toContain('approved');
  });
});

describe('pageFrontmatterStatusValues', () => {
  test('contains standard statuses', () => {
    expect(pageFrontmatterStatusValues).toContain('published');
    expect(pageFrontmatterStatusValues).toContain('draft');
  });

  test('contains needs-review', () => {
    expect(pageFrontmatterStatusValues).toContain('needs-review');
  });

  test('contains approved', () => {
    expect(pageFrontmatterStatusValues).toContain('approved');
  });
});
