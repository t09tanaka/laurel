import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readImageDimensions } from '~/util/image-size.ts';

function tempPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'laurel-image-size-'));
  return join(dir, name);
}

function writeBinary(filePath: string, bytes: number[]): void {
  writeFileSync(filePath, Buffer.from(bytes));
}

function writeText(filePath: string, text: string): void {
  writeFileSync(filePath, text, 'utf8');
}

describe('readImageDimensions', () => {
  test('parses SVG width and height attributes', () => {
    const file = tempPath('cover.svg');
    writeText(file, '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>');
    expect(readImageDimensions(file)).toEqual({ width: 1200, height: 630 });
  });

  test('falls back to SVG viewBox when width/height are missing', () => {
    const file = tempPath('cover-vb.svg');
    writeText(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"></svg>');
    expect(readImageDimensions(file)).toEqual({ width: 800, height: 450 });
  });

  test('ignores SVG with percentage width', () => {
    const file = tempPath('cover-pct.svg');
    writeText(file, '<svg width="100%" height="100%"></svg>');
    expect(readImageDimensions(file)).toBeUndefined();
  });

  test('reads PNG IHDR width/height', () => {
    const file = tempPath('pixel.png');
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdrLength = [0x00, 0x00, 0x00, 0x0d];
    const ihdrType = [0x49, 0x48, 0x44, 0x52];
    const width = [0x00, 0x00, 0x01, 0x90]; // 400
    const height = [0x00, 0x00, 0x00, 0xc8]; // 200
    const rest = [0x08, 0x06, 0x00, 0x00, 0x00, 0x9a, 0x76, 0x82, 0x70];
    writeBinary(file, [...sig, ...ihdrLength, ...ihdrType, ...width, ...height, ...rest]);
    expect(readImageDimensions(file)).toEqual({ width: 400, height: 200 });
  });

  test('reads GIF89a width/height', () => {
    const file = tempPath('pixel.gif');
    const sig = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
    const widthLe = [0x40, 0x01]; // 320
    const heightLe = [0xc8, 0x00]; // 200
    writeBinary(file, [...sig, ...widthLe, ...heightLe]);
    expect(readImageDimensions(file)).toEqual({ width: 320, height: 200 });
  });

  test('reads WebP VP8X canvas dimensions', () => {
    const file = tempPath('pixel.webp');
    const riff = [0x52, 0x49, 0x46, 0x46];
    const fileSize = [0x00, 0x00, 0x00, 0x00];
    const webp = [0x57, 0x45, 0x42, 0x50];
    const fourcc = [0x56, 0x50, 0x38, 0x58];
    const chunkSize = [0x0a, 0x00, 0x00, 0x00];
    const flags = [0x00, 0x00, 0x00, 0x00];
    // canvas = (width-1, height-1) as 24-bit LE
    const widthMinusOne = [0xff, 0x01, 0x00]; // 511 -> width 512
    const heightMinusOne = [0xff, 0x00, 0x00]; // 255 -> height 256
    writeBinary(file, [
      ...riff,
      ...fileSize,
      ...webp,
      ...fourcc,
      ...chunkSize,
      ...flags,
      ...widthMinusOne,
      ...heightMinusOne,
    ]);
    expect(readImageDimensions(file)).toEqual({ width: 512, height: 256 });
  });

  test('reads JPEG SOF0 dimensions', () => {
    const file = tempPath('pixel.jpg');
    const soi = [0xff, 0xd8];
    // APP0 segment that we skip over.
    const app0 = [
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00,
    ];
    // SOF0 with width=640 (0x0280), height=480 (0x01e0).
    const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80];
    writeBinary(file, [...soi, ...app0, ...sof0]);
    expect(readImageDimensions(file)).toEqual({ width: 640, height: 480 });
  });

  test('returns undefined for unsupported formats', () => {
    const file = tempPath('mystery.bin');
    writeBinary(file, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(readImageDimensions(file)).toBeUndefined();
  });

  test('returns undefined for missing files', () => {
    expect(readImageDimensions('/nonexistent/path/to/image.png')).toBeUndefined();
  });
});
