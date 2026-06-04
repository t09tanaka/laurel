import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  legacyCacheExists,
  legacyCacheWarning,
  warnIfLegacyCacheDir,
} from '~/cli/legacy-cache-warning.ts';

async function tempCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-legacy-cache-'));
}

describe('legacy .laurel-cache startup warning', () => {
  test('returns no message when the legacy directory is absent', async () => {
    const cwd = await tempCwd();
    try {
      expect(legacyCacheExists(cwd)).toBe(false);
      expect(legacyCacheWarning(cwd)).toBeUndefined();
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('returns a message naming the legacy path when it exists', async () => {
    const cwd = await tempCwd();
    try {
      await Bun.write(join(cwd, '.laurel-cache/marker'), 'legacy');
      const message = legacyCacheWarning(cwd);
      expect(message).toBeDefined();
      expect(message).toContain('.laurel-cache');
      expect(message).toContain('.laurel/cache');
      expect(message).toContain(join(cwd, '.laurel-cache'));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('warnIfLegacyCacheDir invokes the warn callback when the directory exists', async () => {
    const cwd = await tempCwd();
    try {
      await Bun.write(join(cwd, '.laurel-cache/marker'), 'legacy');
      const messages: string[] = [];
      warnIfLegacyCacheDir((message) => messages.push(message), cwd);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('.laurel/cache');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('warnIfLegacyCacheDir stays quiet when no legacy directory exists', async () => {
    const cwd = await tempCwd();
    try {
      const messages: string[] = [];
      warnIfLegacyCacheDir((message) => messages.push(message), cwd);
      expect(messages).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
