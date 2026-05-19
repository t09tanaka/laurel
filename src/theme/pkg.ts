import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ThemeCustomSettingDefinition,
  ThemeImageSize,
  ThemePackage,
} from './types.ts';

interface RawPkg {
  name?: string;
  version?: string;
  config?: {
    posts_per_page?: number;
    image_sizes?: Record<string, ThemeImageSize>;
    card_assets?: boolean | string[];
    custom?: Record<string, ThemeCustomSettingDefinition & { default?: unknown }>;
  };
}

export async function loadThemePackage(rootDir: string): Promise<ThemePackage> {
  const path = join(rootDir, 'package.json');
  if (!existsSync(path)) {
    return defaultPackage();
  }
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as RawPkg;
  const cfg = parsed.config ?? {};
  const custom = cfg.custom ?? {};
  const customDefaults: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(custom)) {
    if (def && Object.prototype.hasOwnProperty.call(def, 'default')) {
      customDefaults[key] = def.default;
    } else if (def && def.type === 'boolean') {
      customDefaults[key] = false;
    } else if (def && def.type === 'select' && Array.isArray(def.options) && def.options[0]) {
      customDefaults[key] = def.options[0];
    } else {
      customDefaults[key] = '';
    }
  }
  return {
    name: parsed.name ?? 'theme',
    version: parsed.version ?? '0.0.0',
    posts_per_page: cfg.posts_per_page ?? 5,
    image_sizes: cfg.image_sizes ?? {},
    card_assets: Boolean(cfg.card_assets),
    custom,
    customDefaults,
  };
}

function defaultPackage(): ThemePackage {
  return {
    name: 'theme',
    version: '0.0.0',
    posts_per_page: 5,
    image_sizes: {},
    card_assets: false,
    custom: {},
    customDefaults: {},
  };
}
