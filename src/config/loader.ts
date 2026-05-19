import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import TOML from '@iarna/toml';
import { configSchema, type NectarConfig } from './schema.ts';

const CONFIG_NAMES = ['nectar.toml', 'nectar.config.toml'];

export interface LoadConfigOptions {
  cwd: string;
  configPath?: string | undefined;
}

export async function loadConfig({ cwd, configPath }: LoadConfigOptions): Promise<NectarConfig> {
  const resolved = configPath ? resolveConfigPath(cwd, configPath) : await findConfig(cwd);
  if (!resolved) {
    return configSchema.parse({});
  }
  const raw = await readFile(resolved, 'utf8');
  const parsed = TOML.parse(raw);
  return configSchema.parse(parsed);
}

function resolveConfigPath(cwd: string, configPath: string): string {
  return isAbsolute(configPath) ? configPath : join(cwd, configPath);
}

async function findConfig(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_NAMES) {
    const candidate = join(cwd, name);
    const file = Bun.file(candidate);
    if (await file.exists()) return candidate;
  }
  return undefined;
}
