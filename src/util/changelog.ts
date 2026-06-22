/**
 * CHANGELOG.md parsing for the release flow.
 *
 * CHANGELOG.md is the single source of truth for "what changed and why" in a
 * release. The release flow extracts the section for the version being shipped
 * and feeds it into the GitHub Release body. Keeping the parser here (pure,
 * no I/O) lets `scripts/release-notes.ts` orchestrate gh/network while the
 * extraction stays unit-testable.
 */

export interface ChangelogSection {
  /** Version as written in the heading, normalized without a leading `v`. */
  version: string;
  /** ISO date from the heading (`## [x.y.z] - 2026-06-22`), or null if absent. */
  date: string | null;
  /** Markdown body of the section (everything below the heading), trimmed. */
  body: string;
  /**
   * The next-older version heading below this one (skipping `[Unreleased]`),
   * used to build a `compare/<prev>...<this>` link. Null for the first release.
   */
  previousVersion: string | null;
}

interface Heading {
  version: string;
  date: string | null;
  /** Line index of the heading itself. */
  index: number;
}

// Matches Keep a Changelog headings: `## [0.1.12] - 2026-06-22` or `## [Unreleased]`.
const HEADING_RE = /^##\s+\[([^\]]+)\]\s*(?:-\s*(.+?))?\s*$/;

const UNRELEASED = 'unreleased';

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function parseHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]?.match(HEADING_RE);
    if (!match?.[1]) continue;
    headings.push({
      version: normalizeVersion(match[1]),
      date: match[2]?.trim() || null,
      index,
    });
  }
  return headings;
}

/**
 * Extract the CHANGELOG section for a given version. Throws if the version has
 * no section so a release never ships with empty or wrong notes.
 */
export function extractChangelogSection(changelog: string, version: string): ChangelogSection {
  const target = normalizeVersion(version);
  const lines = changelog.split('\n');
  const headings = parseHeadings(lines);

  const position = headings.findIndex((h) => h.version.toLowerCase() === target.toLowerCase());
  const heading = headings[position];
  if (position === -1 || !heading) {
    const known = headings
      .map((h) => h.version)
      .filter((v) => v.toLowerCase() !== UNRELEASED)
      .join(', ');
    throw new Error(
      `No CHANGELOG.md section found for version ${target}. Known versions: ${known || '(none)'}.`,
    );
  }

  const next = headings[position + 1];
  const bodyStart = heading.index + 1;
  const bodyEnd = next ? next.index : lines.length;
  const body = lines.slice(bodyStart, bodyEnd).join('\n').trim();

  // The compare base is the next heading below that is an actual version.
  let previousVersion: string | null = null;
  for (let i = position + 1; i < headings.length; i++) {
    const candidate = headings[i];
    if (candidate && candidate.version.toLowerCase() !== UNRELEASED) {
      previousVersion = candidate.version;
      break;
    }
  }

  return { version: heading.version, date: heading.date, body, previousVersion };
}
