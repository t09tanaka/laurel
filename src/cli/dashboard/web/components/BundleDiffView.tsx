import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { type DiffRow, applyDiffSelection, diffLines } from '../lib/linediff.ts';

interface BundleDiffViewProps {
  /** Editorial content (title on the first line, body after) already on disk. */
  existing: string;
  /** Editorial content the bundle would bring in on overwrite. */
  incoming: string;
  busy: boolean;
  onBack: () => void;
  /** Receives the per-line merge of the two editorial sides (title + body). */
  onApply: (merged: string) => void;
}

type RenderGroup =
  | { kind: 'context'; key: string; rows: DiffRow[] }
  | { kind: 'change'; key: string; segment: number; rows: DiffRow[] };

function groupRows(rows: DiffRow[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const row of rows) {
    if (row.type === 'context') {
      const last = groups[groups.length - 1];
      if (last?.kind === 'context') last.rows.push(row);
      else groups.push({ kind: 'context', key: `c${groups.length}`, rows: [row] });
      continue;
    }
    const segment = row.segment ?? -1;
    const last = groups[groups.length - 1];
    if (last?.kind === 'change' && last.segment === segment) last.rows.push(row);
    else groups.push({ kind: 'change', key: `s${segment}`, segment, rows: [row] });
  }
  return groups;
}

function gutter(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * GitHub-style review of an import collision: a unified line diff where each
 * changed hunk can be accepted (take the incoming version) or kept (preserve
 * the existing version). Hunks default to accepted, matching the previous
 * overwrite behavior; deselecting one keeps that part of the existing entry.
 */
export function BundleDiffView({
  existing,
  incoming,
  busy,
  onBack,
  onApply,
}: BundleDiffViewProps): JSX.Element {
  const diff = useMemo(() => diffLines(existing, incoming), [existing, incoming]);
  const groups = useMemo(() => groupRows(diff.rows), [diff.rows]);
  const [accepted, setAccepted] = useState<Set<number>>(
    () => new Set(diff.segments.map((s) => s.id)),
  );

  const total = diff.segments.length;

  function toggle(id: number): void {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(on: boolean): void {
    setAccepted(on ? new Set(diff.segments.map((s) => s.id)) : new Set());
  }

  function apply(): void {
    onApply(applyDiffSelection(diff, accepted));
  }

  return (
    <div class="bundleDiff">
      <div class="bundleDiffBar">
        <span class="bundleDiffCount">
          {total === 0
            ? 'No differences'
            : `${accepted.size} of ${total} change${total === 1 ? '' : 's'} selected`}
        </span>
        {total > 0 ? (
          <div class="bundleDiffBarActions">
            <button
              type="button"
              class="bundleDiffLink"
              disabled={busy || accepted.size === total}
              onClick={() => setAll(true)}
            >
              Accept all
            </button>
            <button
              type="button"
              class="bundleDiffLink"
              disabled={busy || accepted.size === 0}
              onClick={() => setAll(false)}
            >
              Keep all existing
            </button>
          </div>
        ) : null}
      </div>

      <div class="bundleDiffBody" aria-label="Import differences">
        {total === 0 ? (
          <p class="bundleDiffEmpty">The incoming entry is identical to the existing one.</p>
        ) : (
          groups.map((group) =>
            group.kind === 'context' ? (
              <div key={group.key} class="diffHunk diffHunk--context">
                {group.rows.map((row, i) => (
                  <Line key={`${group.key}-${i}`} row={row} />
                ))}
              </div>
            ) : (
              <div
                key={group.key}
                class="diffHunk diffHunk--change"
                data-accepted={accepted.has(group.segment) ? 'true' : 'false'}
              >
                <label class="diffHunkToggle">
                  <input
                    type="checkbox"
                    checked={accepted.has(group.segment)}
                    disabled={busy}
                    onChange={() => toggle(group.segment)}
                  />
                  <span>{accepted.has(group.segment) ? 'Apply this change' : 'Keep existing'}</span>
                </label>
                {group.rows.map((row, i) => (
                  <Line key={`${group.key}-${i}`} row={row} />
                ))}
              </div>
            ),
          )
        )}
      </div>

      <div class="modalActions">
        <button type="button" class="btn secondary" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="button" class="btn" disabled={busy} onClick={apply}>
          {busy ? 'Importing…' : 'Apply & import'}
        </button>
      </div>
    </div>
  );
}

function Line({ row }: { row: DiffRow }): JSX.Element {
  const mark = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
  return (
    <div class={`diffLine diffLine--${row.type}`}>
      <span class="diffGutter" aria-hidden="true">
        {gutter(row.oldLine)}
      </span>
      <span class="diffGutter" aria-hidden="true">
        {gutter(row.newLine)}
      </span>
      <span class="diffMark" aria-hidden="true">
        {mark}
      </span>
      <code class="diffText">{row.text === '' ? ' ' : row.text}</code>
    </div>
  );
}
