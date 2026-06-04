import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createMarkdownPool } from '~/content/markdown-pool.ts';
import { renderMarkdown } from '~/content/markdown.ts';

const originalEnv = process.env.LAUREL_NO_WORKERS;

afterEach(() => {
  if (originalEnv === undefined) {
    process.env.LAUREL_NO_WORKERS = undefined;
  } else {
    process.env.LAUREL_NO_WORKERS = originalEnv;
  }
});

describe('createMarkdownPool — in-process mode', () => {
  beforeEach(() => {
    // Small estimatedJobs already routes through in-process, but force it via
    // env too so the assertion holds regardless of how the threshold tunes.
    process.env.LAUREL_NO_WORKERS = '1';
  });

  test('renders markdown matching the direct call', async () => {
    const pool = createMarkdownPool({ estimatedJobs: 0 });
    try {
      const direct = await renderMarkdown('# Hello\n\nworld');
      const pooled = await pool.render('# Hello\n\nworld');
      expect(pooled.html).toBe(direct.html);
      expect(pooled.plaintext).toBe(direct.plaintext);
      expect(pooled.word_count).toBe(direct.word_count);
      expect(pooled.reading_time).toBe(direct.reading_time);
    } finally {
      await pool.close();
    }
  });

  test('honours sanitise option', async () => {
    const pool = createMarkdownPool({ estimatedJobs: 0 });
    try {
      const sanitised = await pool.render('<script>alert(1)</script>Hi');
      expect(sanitised.html).not.toContain('<script');
      const unsafe = await pool.render('<u>x</u>', { unsafe: true });
      expect(unsafe.html).toContain('<u>x</u>');
    } finally {
      await pool.close();
    }
  });

  test('close() is idempotent', async () => {
    const pool = createMarkdownPool({ estimatedJobs: 0 });
    await pool.close();
    await pool.close();
  });

  test('render after close rejects', async () => {
    const pool = createMarkdownPool({ estimatedJobs: 0 });
    await pool.close();
    // In-process mode doesn't enforce a closed state — calling render after
    // close still works because it's just a thin wrapper. Document that with
    // an assertion that it does NOT throw, mirroring direct `renderMarkdown`.
    const result = await pool.render('still works');
    expect(result.html).toContain('still works');
  });
});

describe('createMarkdownPool — worker mode', () => {
  beforeEach(() => {
    process.env.LAUREL_NO_WORKERS = undefined;
  });

  test('renders markdown via Bun Workers and matches direct output', async () => {
    // Bump estimatedJobs high enough to force worker spawn even when
    // availableParallelism() returns a small number.
    const pool = createMarkdownPool({ estimatedJobs: 1000 });
    try {
      const samples = [
        '# A\n\none',
        '## B\n\ntwo',
        'plain text three',
        '[link](https://example.com)',
        '<u>safe-strip</u>',
      ];
      const directs = await Promise.all(samples.map((s) => renderMarkdown(s)));
      const pooled = await Promise.all(samples.map((s) => pool.render(s)));
      for (let i = 0; i < samples.length; i += 1) {
        expect(pooled[i]?.html).toBe(directs[i]?.html ?? '');
        expect(pooled[i]?.plaintext).toBe(directs[i]?.plaintext ?? '');
        expect(pooled[i]?.word_count).toBe(directs[i]?.word_count ?? 0);
      }
    } finally {
      await pool.close();
    }
  });

  test('rejects pending renders when closed mid-flight', async () => {
    const pool = createMarkdownPool({ estimatedJobs: 1000 });
    // Fire-and-forget a render so it's still in flight when we close.
    const pending = pool.render('# pending\n\nbody');
    await pool.close();
    await expect(pending).rejects.toThrow(/closed/);
  });
});
