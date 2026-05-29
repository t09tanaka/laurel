import { describe, expect, it } from 'bun:test';
import { applyDiffSelection, diffLines } from '../../../src/cli/dashboard/web/lib/linediff.ts';

describe('diffLines', () => {
  it('marks unchanged lines as context with both line numbers', () => {
    const { rows, segments } = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    expect(segments).toHaveLength(0);
    expect(rows.every((r) => r.type === 'context')).toBe(true);
    expect(rows.map((r) => [r.oldLine, r.newLine])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('groups a replaced line into one segment with del before add', () => {
    const { rows, segments } = diffLines('a\nold\nc\n', 'a\nnew\nc\n');
    expect(segments).toHaveLength(1);
    const seg = segments[0];
    expect(seg?.del).toEqual(['old']);
    expect(seg?.add).toEqual(['new']);
    const changed = rows.filter((r) => r.type !== 'context');
    expect(changed.map((r) => r.type)).toEqual(['del', 'add']);
    expect(changed.every((r) => r.segment === 0)).toBe(true);
  });

  it('represents a pure insertion as an add-only segment', () => {
    const { segments } = diffLines('a\nb\n', 'a\nx\nb\n');
    expect(segments).toHaveLength(1);
    expect(segments[0]?.del).toEqual([]);
    expect(segments[0]?.add).toEqual(['x']);
  });

  it('represents a pure deletion as a del-only segment', () => {
    const { segments } = diffLines('a\nx\nb\n', 'a\nb\n');
    expect(segments).toHaveLength(1);
    expect(segments[0]?.del).toEqual(['x']);
    expect(segments[0]?.add).toEqual([]);
  });

  it('separates non-adjacent changes into distinct segments', () => {
    const { segments } = diffLines('a\nb\nc\nd\n', 'A\nb\nc\nD\n');
    expect(segments).toHaveLength(2);
  });
});

describe('applyDiffSelection', () => {
  const old = 'title: Existing\n\nbody one\nshared\nbody two\n';
  const incoming = 'title: Incoming\n\nbody ONE\nshared\nbody two\n';

  it('reconstructs the existing text when nothing is accepted', () => {
    const diff = diffLines(old, incoming);
    expect(applyDiffSelection(diff, new Set())).toBe(old.replace(/\n$/, ''));
  });

  it('reconstructs the incoming text when every segment is accepted', () => {
    const diff = diffLines(old, incoming);
    const all = new Set(diff.segments.map((s) => s.id));
    expect(applyDiffSelection(diff, all)).toBe(incoming.replace(/\n$/, ''));
  });

  it('takes incoming for accepted segments and keeps existing for the rest', () => {
    const diff = diffLines(old, incoming);
    // Accept only the first changed segment (the title line).
    const merged = applyDiffSelection(diff, new Set([0]));
    expect(merged).toContain('title: Incoming');
    expect(merged).toContain('body one');
    expect(merged).not.toContain('body ONE');
  });

  it('handles inputs without trailing newlines', () => {
    const diff = diffLines('a\nb', 'a\nc');
    expect(applyDiffSelection(diff, new Set())).toBe('a\nb');
    expect(applyDiffSelection(diff, new Set([0]))).toBe('a\nc');
  });
});
