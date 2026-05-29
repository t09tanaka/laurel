import { inflateRawSync } from 'node:zlib';

export interface ZipFileEntry {
  path: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export function readZipArchive(data: Uint8Array): ZipFileEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data, view);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipFileEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CEN_SIG) {
      throw new Error('Invalid zip: bad central directory header');
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(data.subarray(p + 46, p + 46 + nameLen));
    entries.push({ path: name, bytes: readLocal(data, view, localOffset, method, compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(data: Uint8Array, view: DataView): number {
  const min = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('Invalid zip: end of central directory not found');
}

function readLocal(
  data: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error('Invalid zip: bad local file header');
  }
  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLen + extraLen;
  const payload = data.subarray(start, start + compSize);
  if (method === 0) return new Uint8Array(payload);
  if (method === 8) {
    const out = inflateRawSync(payload);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  throw new Error(`Invalid zip: unsupported compression method ${method}`);
}
