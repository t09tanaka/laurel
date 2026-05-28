import { describe, expect, test } from 'bun:test';
import { computeWarnings } from '../../../src/cli/dashboard/web/lib/editor-warnings.ts';

describe('computeWarnings', () => {
  test('reports empty markdown image alt text with a line number', () => {
    expect(computeWarnings('Intro\n\n![](/content/images/photo.jpg)')).toEqual([
      'Markdown image has empty alt text at line 3.',
    ]);
  });

  test('does not warn when markdown image alt text is present', () => {
    expect(computeWarnings('![Phone plan](/content/images/photo.jpg)')).toEqual([]);
  });

  test('does not treat component shortcodes as image warnings', () => {
    expect(computeWarnings('{ghost-html-card-dff603a788ac}')).toEqual([]);
  });

  test('ignores markdown image examples inside fenced code blocks', () => {
    expect(computeWarnings('```md\n![](/content/images/photo.jpg)\n```\n\nBody text')).toEqual([]);
  });

  test('reports html images missing alt attributes with a line number', () => {
    expect(computeWarnings('Text\n<img src="/banner.jpg">')).toEqual([
      'HTML image is missing an alt attribute at line 2.',
    ]);
  });

  test('does not warn for html images with alt attributes', () => {
    expect(computeWarnings('<img src="/banner.jpg" alt="Banner">')).toEqual([]);
  });
});
