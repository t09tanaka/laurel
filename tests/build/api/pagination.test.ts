import { describe, expect, test } from 'bun:test';
import { projectPagination } from '~/build/api/pagination.ts';

describe('projectPagination (#216)', () => {
  test('single-page collection: pages=1, next/prev null when limit defaults to total', () => {
    expect(projectPagination({ total: 3 })).toEqual({
      page: 1,
      limit: 3,
      pages: 1,
      total: 3,
      next: null,
      prev: null,
    });
  });

  test('empty collection: pages clamps to 1, limit defaults to sentinel 1', () => {
    expect(projectPagination({ total: 0 })).toEqual({
      page: 1,
      limit: 1,
      pages: 1,
      total: 0,
      next: null,
      prev: null,
    });
  });

  test('explicit limit: computes pages via ceil(total / limit)', () => {
    expect(projectPagination({ page: 1, limit: 5, total: 12 })).toEqual({
      page: 1,
      limit: 5,
      pages: 3,
      total: 12,
      next: 2,
      prev: null,
    });
  });

  test('middle page: both next and prev are populated', () => {
    expect(projectPagination({ page: 2, limit: 5, total: 12 })).toEqual({
      page: 2,
      limit: 5,
      pages: 3,
      total: 12,
      next: 3,
      prev: 1,
    });
  });

  test('last page: next is null', () => {
    expect(projectPagination({ page: 3, limit: 5, total: 12 })).toEqual({
      page: 3,
      limit: 5,
      pages: 3,
      total: 12,
      next: null,
      prev: 2,
    });
  });

  test("limit: 'all' collapses pages to 1 and clears next/prev", () => {
    expect(projectPagination({ page: 1, limit: 'all', total: 42 })).toEqual({
      page: 1,
      limit: 'all',
      pages: 1,
      total: 42,
      next: null,
      prev: null,
    });
  });

  test("limit: 'all' with empty collection still emits well-formed meta", () => {
    expect(projectPagination({ limit: 'all', total: 0 })).toEqual({
      page: 1,
      limit: 'all',
      pages: 1,
      total: 0,
      next: null,
      prev: null,
    });
  });

  test('over-the-end page clamps to last real page so next/prev stay sane', () => {
    // page=10 against a 3-page collection. We clamp to 3 so consumers that
    // pass an out-of-range page (e.g. a stale cursor) get a terminal but
    // well-formed meta block, not NaN.
    expect(projectPagination({ page: 10, limit: 5, total: 12 })).toEqual({
      page: 3,
      limit: 5,
      pages: 3,
      total: 12,
      next: null,
      prev: 2,
    });
  });

  test('page <= 0 clamps to 1 so the meta is always valid', () => {
    const meta = projectPagination({ page: 0, limit: 5, total: 12 });
    expect(meta.page).toBe(1);
    expect(meta.prev).toBe(null);
  });

  test('exactly-divisible totals do not over-allocate a trailing page', () => {
    expect(projectPagination({ page: 2, limit: 5, total: 10 }).pages).toBe(2);
    expect(projectPagination({ page: 2, limit: 5, total: 10 }).next).toBe(null);
  });

  test('rejects non-positive numeric limits with a descriptive error', () => {
    expect(() => projectPagination({ limit: 0, total: 5 })).toThrow(/positive integer/);
    expect(() => projectPagination({ limit: -3, total: 5 })).toThrow(/positive integer/);
  });

  test('rejects non-finite limits', () => {
    expect(() => projectPagination({ limit: Number.NaN, total: 5 })).toThrow(/positive integer/);
  });

  test('truncates fractional page / limit / total to integers', () => {
    // Defensive: callers occasionally pass `Number(queryParam)` which can
    // yield floats. We truncate rather than throw because the SDK swallows
    // type errors and the resulting meta is still consistent.
    const meta = projectPagination({ page: 2.7, limit: 5.9, total: 12.3 });
    expect(meta.page).toBe(2);
    expect(meta.limit).toBe(5);
    expect(meta.total).toBe(12);
  });
});
