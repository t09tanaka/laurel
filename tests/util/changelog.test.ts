import { describe, expect, test } from 'bun:test';
import { extractChangelogSection } from '~/util/changelog.ts';

const SAMPLE = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

_Nothing yet._

## [0.1.12] - 2026-06-22

### Added

- WebP \`<picture>\` wrapping for theme feature images. (#682)

## [0.1.11] - 2026-06-19

### Fixed

- Stale output reconciliation at output_dir scope. (#680)

## [0.1.1] - 2026-06-18

### Added

- First real feature.
`;

describe('extractChangelogSection', () => {
  test('extracts body, date, and previous version', () => {
    const section = extractChangelogSection(SAMPLE, '0.1.12');
    expect(section.version).toBe('0.1.12');
    expect(section.date).toBe('2026-06-22');
    expect(section.previousVersion).toBe('0.1.11');
    expect(section.body).toContain('WebP');
    expect(section.body).not.toContain('## [0.1.11]');
    expect(section.body.startsWith('### Added')).toBe(true);
  });

  test('tolerates a leading v on the requested version', () => {
    expect(extractChangelogSection(SAMPLE, 'v0.1.11').version).toBe('0.1.11');
  });

  test('skips the Unreleased heading when computing previous version', () => {
    // 0.1.12 is the newest real version; Unreleased sits above it but must be
    // ignored as a compare base.
    expect(extractChangelogSection(SAMPLE, '0.1.12').previousVersion).toBe('0.1.11');
  });

  test('returns null previousVersion for the oldest section', () => {
    expect(extractChangelogSection(SAMPLE, '0.1.1').previousVersion).toBeNull();
  });

  test('throws with known versions when the section is missing', () => {
    expect(() => extractChangelogSection(SAMPLE, '9.9.9')).toThrow(/No CHANGELOG.md section/);
    expect(() => extractChangelogSection(SAMPLE, '9.9.9')).toThrow(/0\.1\.12/);
  });

  test('does not treat Unreleased as a requestable version body leak', () => {
    const section = extractChangelogSection(SAMPLE, 'Unreleased');
    expect(section.body).toBe('_Nothing yet._');
    expect(section.previousVersion).toBe('0.1.12');
  });
});
