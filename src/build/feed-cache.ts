import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FeedManifestEntry } from './manifest.ts';
import { stableStringify } from './manifest.ts';

export type FeedManifestMap = Record<string, FeedManifestEntry>;

export function computeFeedHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

export async function shouldSkipFeedWrite(opts: {
  outputDir: string;
  outputPath: string;
  hash: string;
  previousFeeds?: FeedManifestMap | undefined;
  key: string;
  companions?: string[] | undefined;
}): Promise<boolean> {
  const previous = opts.previousFeeds?.[opts.key];
  if (!previous || previous.hash !== opts.hash || previous.outputPath !== opts.outputPath) {
    return false;
  }
  if (!(await Bun.file(join(opts.outputDir, opts.outputPath)).exists())) return false;
  for (const companion of opts.companions ?? []) {
    if (!(await Bun.file(join(opts.outputDir, companion)).exists())) return false;
  }
  return true;
}

export function recordFeedManifest(
  feeds: FeedManifestMap | undefined,
  key: string,
  entry: FeedManifestEntry,
): void {
  if (!feeds) return;
  feeds[key] = entry;
}
