import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Minimal in-process ZIP writer.
//
// We can't shell out to the `zip` binary because the CI matrix includes
// windows-latest, where it is not pre-installed. The third-party JS zip
// libraries that exist are not small enough to bring into the dashboard
// dependency surface for this single use case, so we hand-roll the bits.
// Format reference: APPNOTE.TXT, sections 4.3.6 (local file header),
// 4.3.12 (central directory header), 4.3.16 (end of central directory).
//
// Limitations: no Zip64, no encryption, no extra fields. Output dirs that
// exceed 2^32 bytes total or contain >65535 files will hit the spec's 32-bit
// caps — Laurel dist outputs are nowhere near either ceiling.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i] ?? 0;
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  pathBytes: Uint8Array;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
}

async function* walkFiles(rootDir: string): AsyncGenerator<{ absPath: string; relPath: string }> {
  const queue: string[] = [rootDir];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const entries = await readdir(cur, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
      } else if (entry.isFile()) {
        const rel = relative(rootDir, abs).split(sep).join('/');
        yield { absPath: abs, relPath: rel };
      }
    }
  }
}

function makeLocalHeader(entry: ZipEntry): Uint8Array {
  const header = new Uint8Array(30 + entry.pathBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0x21, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.compressedSize, true);
  view.setUint32(22, entry.uncompressedSize, true);
  view.setUint16(26, entry.pathBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(entry.pathBytes, 30);
  return header;
}

function makeCentralHeader(entry: ZipEntry): Uint8Array {
  const header = new Uint8Array(46 + entry.pathBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0x21, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.compressedSize, true);
  view.setUint32(24, entry.uncompressedSize, true);
  view.setUint16(28, entry.pathBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  header.set(entry.pathBytes, 46);
  return header;
}

function makeEocd(
  totalEntries: number,
  centralDirSize: number,
  centralDirOffset: number,
): Uint8Array {
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, totalEntries, true);
  view.setUint16(10, totalEntries, true);
  view.setUint32(12, centralDirSize, true);
  view.setUint32(16, centralDirOffset, true);
  view.setUint16(20, 0, true);
  return eocd;
}

export interface ZipInputEntry {
  path: string;
  bytes: Uint8Array;
}

export function createZipArchive(inputs: ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const input of inputs) {
    const crc = crc32(input.bytes);
    const compressed = deflateRawSync(input.bytes);
    const useDeflate = compressed.length < input.bytes.length;
    const payload = useDeflate
      ? new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength)
      : input.bytes;
    const entry: ZipEntry = {
      pathBytes: encoder.encode(input.path),
      crc,
      compressedSize: payload.length,
      uncompressedSize: input.bytes.length,
      method: useDeflate ? 8 : 0,
      localHeaderOffset: offset,
    };
    const local = makeLocalHeader(entry);
    chunks.push(local, payload);
    offset += local.length + payload.length;
    entries.push(entry);
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of entries) {
    const central = makeCentralHeader(entry);
    chunks.push(central);
    centralSize += central.length;
  }
  chunks.push(makeEocd(entries.length, centralSize, centralOffset));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export function createDistZipStream(rootDir: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const entries: ZipEntry[] = [];
      let offset = 0;
      try {
        for await (const file of walkFiles(rootDir)) {
          const data = await readFile(file.absPath);
          const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const crc = crc32(u8);
          const compressed = deflateRawSync(u8);
          const useDeflate = compressed.length < u8.length;
          const payload = useDeflate
            ? new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength)
            : u8;
          const method = useDeflate ? 8 : 0;
          const pathBytes = encoder.encode(file.relPath);
          const entry: ZipEntry = {
            pathBytes,
            crc,
            compressedSize: payload.length,
            uncompressedSize: u8.length,
            method,
            localHeaderOffset: offset,
          };
          const local = makeLocalHeader(entry);
          controller.enqueue(local);
          controller.enqueue(payload);
          offset += local.length + payload.length;
          entries.push(entry);
        }
        const centralOffset = offset;
        let centralSize = 0;
        for (const entry of entries) {
          const central = makeCentralHeader(entry);
          controller.enqueue(central);
          centralSize += central.length;
        }
        controller.enqueue(makeEocd(entries.length, centralSize, centralOffset));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
