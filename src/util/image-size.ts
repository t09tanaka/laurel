import { readFileSync } from 'node:fs';

export interface ImageDimensions {
  width: number;
  height: number;
}

// Best-effort intrinsic dimension reader for the formats Ghost-compatible
// themes typically reference (SVG, PNG, JPEG, GIF, WebP). Returns undefined
// for unsupported or unparseable files so the caller can fall back to
// emitting <img> without width/height rather than failing the build.
export function readImageDimensions(filePath: string): ImageDimensions | undefined {
  let head: Buffer;
  try {
    head = readFileChunk(filePath, 65536);
  } catch {
    return undefined;
  }
  if (head.length === 0) return undefined;

  return (
    parsePng(head) ??
    parseGif(head) ??
    parseWebp(head) ??
    parseJpeg(head, filePath) ??
    parseSvg(head)
  );
}

function readFileChunk(filePath: string, maxBytes: number): Buffer {
  const full = readFileSync(filePath);
  return full.length > maxBytes ? full.subarray(0, maxBytes) : full;
}

function parsePng(buf: Buffer): ImageDimensions | undefined {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk at offset 8.
  if (buf.length < 24) return undefined;
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0d ||
    buf[5] !== 0x0a ||
    buf[6] !== 0x1a ||
    buf[7] !== 0x0a
  ) {
    return undefined;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}

function parseGif(buf: Buffer): ImageDimensions | undefined {
  if (buf.length < 10) return undefined;
  const sig = buf.subarray(0, 6).toString('ascii');
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return undefined;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}

function parseWebp(buf: Buffer): ImageDimensions | undefined {
  if (buf.length < 30) return undefined;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') return undefined;
  if (buf.subarray(8, 12).toString('ascii') !== 'WEBP') return undefined;
  const fourcc = buf.subarray(12, 16).toString('ascii');
  if (fourcc === 'VP8 ') {
    // Simple format: width/height are 14-bit values inside the frame header.
    if (buf.length < 30) return undefined;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width === 0 || height === 0) return undefined;
    return { width, height };
  }
  if (fourcc === 'VP8L') {
    if (buf.length < 25) return undefined;
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
      return undefined;
    }
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourcc === 'VP8X') {
    const width = 1 + (buf.readUIntLE(24, 3) & 0xffffff);
    const height = 1 + (buf.readUIntLE(27, 3) & 0xffffff);
    return { width, height };
  }
  return undefined;
}

function parseJpeg(buf: Buffer, filePath: string): ImageDimensions | undefined {
  if (buf.length < 4) return undefined;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  // Walk JPEG segments looking for an SOF marker. If the head buffer doesn't
  // contain it, fall back to reading the entire file once.
  const found = scanJpegSof(buf);
  if (found) return found;
  try {
    const full = readFileSync(filePath);
    if (full.length === buf.length) return undefined;
    return scanJpegSof(full);
  } catch {
    return undefined;
  }
}

function scanJpegSof(buf: Buffer): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 8 < buf.length) {
    if (buf[offset] !== 0xff) return undefined;
    let marker = buf[offset + 1] ?? 0;
    offset += 2;
    while (marker === 0xff && offset < buf.length) {
      marker = buf[offset] ?? 0;
      offset += 1;
    }
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buf.length) return undefined;
    const segmentLength = buf.readUInt16BE(offset);
    if (isSofMarker(marker)) {
      if (offset + 7 > buf.length) return undefined;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return undefined;
      return { width, height };
    }
    offset += segmentLength;
  }
  return undefined;
}

function isSofMarker(marker: number): boolean {
  // SOF0..SOF15 except DHT (0xC4), JPG (0xC8), DAC (0xCC).
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function parseSvg(buf: Buffer): ImageDimensions | undefined {
  // Heuristic SVG parser: look for the opening <svg ...> tag in the first
  // few KB and pull width/height (or viewBox as a fallback).
  const sample = buf.subarray(0, Math.min(buf.length, 8192)).toString('utf8');
  const tagMatch = sample.match(/<svg\b[^>]*>/i);
  if (!tagMatch) return undefined;
  const tag = tagMatch[0];
  const width = readSvgLength(tag, 'width');
  const height = readSvgLength(tag, 'height');
  if (width !== undefined && height !== undefined) {
    return { width, height };
  }
  const viewBox = tag.match(/\bviewBox\s*=\s*["']\s*([^"']+)["']/i);
  if (!viewBox?.[1]) return undefined;
  const parts = viewBox[1].trim().split(/[\s,]+/);
  if (parts.length !== 4) return undefined;
  const vbWidth = Number.parseFloat(parts[2] ?? '');
  const vbHeight = Number.parseFloat(parts[3] ?? '');
  if (!Number.isFinite(vbWidth) || !Number.isFinite(vbHeight)) return undefined;
  if (vbWidth <= 0 || vbHeight <= 0) return undefined;
  return { width: Math.round(vbWidth), height: Math.round(vbHeight) };
}

function readSvgLength(tag: string, attr: string): number | undefined {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([^"']+)["']`, 'i'));
  if (!match?.[1]) return undefined;
  // Strip unit suffix (px, pt, em, %, etc.) — percentage and relative units
  // can't be resolved without layout context, so treat them as unknown.
  const value = match[1].trim();
  if (value.endsWith('%')) return undefined;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(numeric);
}
