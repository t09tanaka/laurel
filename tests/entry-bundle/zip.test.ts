import { describe, expect, test } from 'bun:test';
import { createZipArchive } from '~/cli/dashboard/zip-writer';

// Task 3: in-memory zip builder
describe('createZipArchive', () => {
  test('builds a 2-entry archive with valid EOCD', () => {
    const entries = [
      { path: 'hello.txt', bytes: new TextEncoder().encode('Hello, World!') },
      { path: 'data/foo.bin', bytes: new Uint8Array([0, 1, 2, 3, 4]) },
    ];
    const zip = createZipArchive(entries);
    // Last 22 bytes are the EOCD
    const eocd = zip.subarray(zip.length - 22);
    const view = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    // EOCD signature at offset 0 (little-endian)
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    // total entries field at offset 10
    expect(view.getUint16(10, true)).toBe(2);
  });
});
