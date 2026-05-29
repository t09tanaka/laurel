import { stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib';
import { pLimit } from '~/util/concurrency.ts';
import { scanGlob } from '~/util/fs.ts';

// Static hosts (Cloudflare Pages, Netlify, nginx with `gzip_static` /
// `brotli_static`) can serve `<file>.br` and `<file>.gz` directly when the
// client's `Accept-Encoding` matches, skipping per-request compression. Doing
// this once at build time at the highest quality (Brotli 11, gzip 9) trades a
// few seconds of build time for materially smaller bodies on every request.
//
// Only text payloads are precompressed — binary formats (PNG/JPEG/WOFF2/AVIF)
// already carry their own compression and a Brotli/gzip pass over them is
// pure overhead. Files below `MIN_BYTES` are skipped because the encoded
// envelope can be larger than the original; for tiny files the host's
// transfer-encoding pass (or no encoding at all) is fine.
const PRECOMPRESS_EXTS = new Set([
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.xml',
  '.txt',
  '.map',
]);

// 256 B floor: below this Brotli/gzip overhead routinely exceeds savings. The
// number is the same one the nginx `gzip_min_length` doc recommends and what
// most CDNs internally use.
const MIN_BYTES = 256;

// Cap on parallel compress operations. Brotli q=11 is CPU-bound and
// `availableParallelism()`-shaped is the natural fit, but we use a small
// constant to keep the build's other phases (image variants, minify) able to
// share the CPU. zlib's threadpool is bounded by `UV_THREADPOOL_SIZE`
// (default 4) so going wider here would queue on libuv anyway.
const COMPRESS_CONCURRENCY = 8;

const brotliCompressP = (buf: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    brotliCompress(
      buf,
      {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      },
      (err, out) => (err ? reject(err) : resolve(out)),
    );
  });

const gzipP = (buf: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    gzip(buf, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out)));
  });

interface PrecompressOptions {
  outputDir: string;
  enabled: boolean;
  // Only emit Brotli, skip gzip. Useful for hosts that always have Brotli
  // available; saves ~50% of the precompress time at a small compatibility
  // cost on very old clients.
  brotliOnly?: boolean;
}

interface PrecompressResult {
  // Number of input files compressed. Companion outputs (.br, .gz) are
  // counted as a pair — i.e. one input → up to two emits.
  fileCount: number;
}

export async function precompressOutput(opts: PrecompressOptions): Promise<PrecompressResult> {
  if (!opts.enabled) return { fileCount: 0 };
  const all = await scanGlob('**/*', { cwd: opts.outputDir, onlyFiles: true });
  // Filter to extensions worth compressing and skip already-encoded
  // companion outputs so a rerun doesn't try to compress its own `.br`/`.gz`.
  const candidates = all.filter((rel) => {
    const ext = extname(rel).toLowerCase();
    if (rel.endsWith('.br') || rel.endsWith('.gz')) return false;
    return PRECOMPRESS_EXTS.has(ext);
  });
  if (candidates.length === 0) return { fileCount: 0 };

  const limit = pLimit(COMPRESS_CONCURRENCY);
  let count = 0;
  await Promise.all(
    candidates.map((rel) =>
      limit(async () => {
        const abs = join(opts.outputDir, rel);
        const s = await stat(abs);
        if (s.size < MIN_BYTES) return;
        const file = Bun.file(abs);
        const buf = Buffer.from(await file.arrayBuffer());
        const brTask = brotliCompressP(buf).then((br) => writeFile(`${abs}.br`, br));
        const gzTask = opts.brotliOnly
          ? Promise.resolve()
          : gzipP(buf).then((gz) => writeFile(`${abs}.gz`, gz));
        await Promise.all([brTask, gzTask]);
        count++;
      }),
    ),
  );
  return { fileCount: count };
}
