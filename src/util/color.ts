export type TextColorClass = 'has-light-text' | 'has-dark-text';

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  transparent: [255, 255, 255],
};

export function textColorClassFor(color: string | undefined | null): TextColorClass {
  const rgb = parseColorToRgb(color);
  if (!rgb) return 'has-dark-text';
  const [r, g, b] = rgb;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? 'has-dark-text' : 'has-light-text';
}

function parseColorToRgb(input: string | undefined | null): [number, number, number] | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('#')) return parseHex(value.slice(1));

  const named = NAMED_COLORS[value];
  if (named) return named;

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) return parseRgbArgs(rgbMatch[1] ?? '');

  return null;
}

function parseHex(hex: string): [number, number, number] | null {
  let normalized = hex;
  if (normalized.length === 3 || normalized.length === 4) {
    normalized = normalized
      .slice(0, 3)
      .split('')
      .map((ch) => ch + ch)
      .join('');
  } else if (normalized.length === 8) {
    normalized = normalized.slice(0, 6);
  } else if (normalized.length !== 6) {
    return null;
  }
  if (!/^[0-9a-f]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function parseRgbArgs(args: string): [number, number, number] | null {
  const parts = args
    .split(/[,\s/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const channels: number[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = parts[i];
    if (!raw) return null;
    const channel = parseChannel(raw);
    if (channel === null) return null;
    channels.push(channel);
  }
  return [channels[0], channels[1], channels[2]] as [number, number, number];
}

function parseChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number.parseFloat(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(255, Math.round((pct / 100) * 255)));
  }
  const num = Number.parseFloat(token);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(255, Math.round(num)));
}
