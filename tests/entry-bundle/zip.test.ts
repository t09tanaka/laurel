import { describe, expect, test } from 'bun:test';
import { createZipArchive } from '~/cli/dashboard/zip-writer';
import { readZipArchive } from '~/entry-bundle/zip';

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

// Task 4: round-trip reader
describe('readZipArchive', () => {
  test('round-trips text and binary entries', () => {
    const textBytes = new TextEncoder().encode('# Hello\nThis is entry.md\n');
    const binBytes = new Uint8Array([0, 1, 2, 255, 254]);
    const inputs = [
      { path: 'entry.md', bytes: textBytes },
      { path: 'assets/images/a.bin', bytes: binBytes },
    ];
    const zip = createZipArchive(inputs);
    const result = readZipArchive(zip);
    expect(result).toHaveLength(2);

    const mdEntry = result.find((e) => e.path === 'entry.md');
    expect(mdEntry).toBeDefined();
    expect(mdEntry?.bytes).toEqual(textBytes);

    const binEntry = result.find((e) => e.path === 'assets/images/a.bin');
    expect(binEntry).toBeDefined();
    expect(binEntry?.bytes).toEqual(binBytes);
  });

  test('throws on invalid zip data', () => {
    expect(() => readZipArchive(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
