/**
 * Minimal line-level diff for the import conflict view. Produces a unified
 * sequence of rows (context / removed / added) grouped into change segments,
 * each of which the UI can independently accept (take the incoming version) or
 * reject (keep the existing version). `applyDiffSelection` reassembles the
 * merged text from those decisions.
 *
 * No external dependency: a single LCS pass is plenty for entry-sized content,
 * and it keeps the dashboard bundle lean. Pathologically large inputs fall back
 * to a whole-file replace so we never allocate an unbounded matrix.
 */

export type DiffRowType = 'context' | 'del' | 'add';

export interface DiffRow {
  type: DiffRowType;
  text: string;
  /** 1-based line number in the existing (old) text; absent for added rows. */
  oldLine?: number;
  /** 1-based line number in the incoming (new) text; absent for removed rows. */
  newLine?: number;
  /** Index into `segments`; absent for context rows. */
  segment?: number;
}

export interface DiffSegment {
  /** Stable id, equal to the index into `segments`. */
  id: number;
  /** Lines removed from the existing entry. */
  del: string[];
  /** Lines added by the incoming entry. */
  add: string[];
}

export interface LineDiff {
  rows: DiffRow[];
  segments: DiffSegment[];
}

// Above this many matrix cells we skip the LCS and emit one replace segment.
const MAX_MATRIX_CELLS = 4_000_000;

/** Split for diffing: drop a single trailing newline so the view has no dangling blank row. */
function toLines(text: string): string[] {
  return text.replace(/\n$/, '').split('\n');
}

type Op = { kind: 'eq' | 'del' | 'add'; text: string };

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_MATRIX_CELLS) {
    return [
      ...a.map((text): Op => ({ kind: 'del', text })),
      ...b.map((text): Op => ({ kind: 'add', text })),
    ];
  }

  // dp[i][j] = length of the LCS of a[i:] and b[j:].
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] as Uint32Array;
    const next = dp[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'eq', text: a[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    const deleteScore = (dp[i + 1] as Uint32Array)[j] ?? 0;
    const insertScore = (dp[i] as Uint32Array)[j + 1] ?? 0;
    if (deleteScore >= insertScore) {
      ops.push({ kind: 'del', text: a[i] as string });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: b[j] as string });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++] as string });
  while (j < m) ops.push({ kind: 'add', text: b[j++] as string });
  return ops;
}

/**
 * Diff two texts line by line. Contiguous runs of removals/insertions are
 * coalesced into a single change segment; within a segment removed lines are
 * listed before added lines, GitHub-style.
 */
export function diffLines(oldText: string, newText: string): LineDiff {
  const ops = lcsOps(toLines(oldText), toLines(newText));

  const rows: DiffRow[] = [];
  const segments: DiffSegment[] = [];
  let oldLine = 0;
  let newLine = 0;

  let pendingDel: string[] = [];
  let pendingAdd: string[] = [];

  const flush = (): void => {
    if (pendingDel.length === 0 && pendingAdd.length === 0) return;
    const id = segments.length;
    segments.push({ id, del: pendingDel, add: pendingAdd });
    for (const text of pendingDel) {
      oldLine += 1;
      rows.push({ type: 'del', text, oldLine, segment: id });
    }
    for (const text of pendingAdd) {
      newLine += 1;
      rows.push({ type: 'add', text, newLine, segment: id });
    }
    pendingDel = [];
    pendingAdd = [];
  };

  for (const op of ops) {
    if (op.kind === 'eq') {
      flush();
      oldLine += 1;
      newLine += 1;
      rows.push({ type: 'context', text: op.text, oldLine, newLine });
    } else if (op.kind === 'del') {
      pendingDel.push(op.text);
    } else {
      pendingAdd.push(op.text);
    }
  }
  flush();

  return { rows, segments };
}

/**
 * Reassemble the merged text. Accepted segments contribute their incoming
 * (added) lines; every other segment keeps its existing (removed) lines.
 * Reconstruction is lossless: accept-all yields the incoming text and
 * reject-all yields the existing text (both modulo the trailing newline, which
 * the server re-normalizes on write).
 */
export function applyDiffSelection(diff: LineDiff, accepted: ReadonlySet<number>): string {
  const out: string[] = [];
  for (const row of diff.rows) {
    if (row.type === 'context') {
      out.push(row.text);
    } else if (row.type === 'del') {
      if (row.segment === undefined || !accepted.has(row.segment)) out.push(row.text);
    } else if (row.segment !== undefined && accepted.has(row.segment)) {
      out.push(row.text);
    }
  }
  return out.join('\n');
}
