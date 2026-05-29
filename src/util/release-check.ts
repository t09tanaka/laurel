import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const NPM_LATEST_URL = 'https://registry.npmjs.org/nectar/latest';
const GITHUB_LATEST_URL = 'https://api.github.com/repos/t09tanaka/nectar/releases/latest';

type ReleaseSource = 'npm' | 'github';
type ReleaseCheckStatus = 'disabled' | 'update-available' | 'up-to-date' | 'unknown';
type ReleaseFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ReleaseCheckResult {
  status: ReleaseCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  source?: ReleaseSource;
  cached: boolean;
  checkedAt?: string;
  message?: string;
}

interface ReleaseCacheEntry {
  schema: typeof CACHE_SCHEMA_VERSION;
  fetchedAt: string;
  latestVersion: string;
  source: ReleaseSource;
}

interface ReleaseCheckOptions {
  currentVersion: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  cachePath?: string;
  fetchFn?: ReleaseFetch;
}

export async function checkLatestRelease(
  options: ReleaseCheckOptions,
): Promise<ReleaseCheckResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const currentVersion = normalizeVersion(options.currentVersion);

  if (isUpdateCheckDisabled(env.NECTAR_NO_UPDATE_CHECK)) {
    return {
      status: 'disabled',
      currentVersion,
      cached: false,
      message: 'Update check disabled by NECTAR_NO_UPDATE_CHECK.',
    };
  }

  const checkedAtDate = now();
  const cachePath = options.cachePath ?? defaultReleaseCachePath();
  const cached = await readValidCache(cachePath, checkedAtDate);
  if (cached) {
    return toResult(currentVersion, cached, true);
  }

  try {
    const fetchFn: ReleaseFetch = options.fetchFn ?? ((url, init) => fetch(url, init));
    const latest = await fetchLatestRelease(fetchFn, checkedAtDate);
    await writeReleaseCache(cachePath, latest);
    return toResult(currentVersion, latest, false);
  } catch (err) {
    return {
      status: 'unknown',
      currentVersion,
      cached: false,
      checkedAt: checkedAtDate.toISOString(),
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function defaultReleaseCachePath(): string {
  return join(homedir(), '.cache', 'nectar', 'release.json');
}

export function formatReleaseCheck(result: ReleaseCheckResult): string {
  const lines = [`nectar ${result.currentVersion}`];
  switch (result.status) {
    case 'disabled':
      lines.push(result.message ?? 'Update check disabled.');
      break;
    case 'unknown':
      lines.push(`Unable to check for updates: ${result.message ?? 'unknown error'}`);
      break;
    case 'update-available':
      lines.push(formatLatestLine(result));
      lines.push(`Upgrade available: ${result.currentVersion} -> ${result.latestVersion}`);
      break;
    case 'up-to-date':
      lines.push(`${formatLatestLine(result)} (up to date)`);
      break;
  }
  return `${lines.join('\n')}\n`;
}

function isUpdateCheckDisabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function readValidCache(
  cachePath: string,
  now: Date,
): Promise<ReleaseCacheEntry | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as unknown;
    if (!isReleaseCacheEntry(parsed)) return undefined;
    const fetchedAt = new Date(parsed.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime())) return undefined;
    if (now.getTime() - fetchedAt.getTime() > CACHE_TTL_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeReleaseCache(cachePath: string, entry: ReleaseCacheEntry): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(tempPath, cachePath);
  } catch {
    // A read-only or broken cache directory must not make `nectar version --check` fail.
  }
}

async function fetchLatestRelease(
  fetchFn: ReleaseFetch,
  checkedAtDate: Date,
): Promise<ReleaseCacheEntry> {
  const npm = await fetchJson(fetchFn, NPM_LATEST_URL);
  const npmVersion = readVersion(npm, 'version');
  if (npmVersion) {
    return {
      schema: CACHE_SCHEMA_VERSION,
      fetchedAt: checkedAtDate.toISOString(),
      latestVersion: npmVersion,
      source: 'npm',
    };
  }

  const github = await fetchJson(fetchFn, GITHUB_LATEST_URL);
  const githubVersion = readVersion(github, 'tag_name');
  if (githubVersion) {
    return {
      schema: CACHE_SCHEMA_VERSION,
      fetchedAt: checkedAtDate.toISOString(),
      latestVersion: githubVersion,
      source: 'github',
    };
  }

  throw new Error('No release version found from npm or GitHub.');
}

async function fetchJson(fetchFn: ReleaseFetch, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        accept: 'application/json',
        'user-agent': `nectar/${CACHE_SCHEMA_VERSION} update-check`,
      },
    });
  } catch {
    if (url === NPM_LATEST_URL) return undefined;
    throw new Error('Release metadata request failed.');
  }
  if (!response.ok) {
    if (url === NPM_LATEST_URL) return undefined;
    throw new Error(`Release metadata request failed with HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    if (url === NPM_LATEST_URL) return undefined;
    throw new Error('Release metadata response was not valid JSON.');
  }
}

function readVersion(value: unknown, key: 'version' | 'tag_name'): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? normalizeVersion(raw) : undefined;
}

function toResult(
  currentVersion: string,
  release: ReleaseCacheEntry,
  cached: boolean,
): ReleaseCheckResult {
  const latestVersion = normalizeVersion(release.latestVersion);
  return {
    status: compareSemver(latestVersion, currentVersion) > 0 ? 'update-available' : 'up-to-date',
    currentVersion,
    latestVersion,
    source: release.source,
    cached,
    checkedAt: release.fetchedAt,
  };
}

function formatLatestLine(result: ReleaseCheckResult): string {
  const source = result.source ?? 'unknown';
  const cacheLabel = result.cached ? ', cached' : '';
  return `Latest release: ${result.latestVersion} (${source}${cacheLabel})`;
}

function isReleaseCacheEntry(value: unknown): value is ReleaseCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.schema === CACHE_SCHEMA_VERSION &&
    typeof entry.fetchedAt === 'string' &&
    typeof entry.latestVersion === 'string' &&
    (entry.source === 'npm' || entry.source === 'github')
  );
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === undefined) return 1;
  if (pb.prerelease === undefined) return -1;
  return pa.prerelease > pb.prerelease ? 1 : pa.prerelease < pb.prerelease ? -1 : 0;
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
} {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return { major: 0, minor: 0, patch: 0, prerelease: version };
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}
