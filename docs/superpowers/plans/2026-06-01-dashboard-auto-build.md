# Dashboard Auto-Build (prod-from-source) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `laurel dashboard` (prod, the default mode) is launched from a repository source checkout, serve a freshly built frontend bundle without a manual pre-build or restart; leave the published binary and the `--dev` HMR path unchanged.

**Architecture:** A new isolated module `src/cli/dashboard/source-bundle.ts` detects a source checkout (web entrypoint + tailwind present), compares `web/**` mtimes to the embedded `bundled-assets.ts`, and — only when stale — builds JS (`Bun.build`) and CSS (tailwind CLI) into in-memory strings. `runDashboard` calls this, threads the resulting asset map through `startDashboardServer` → request context, and `serveDashboardBundleAsset` prefers the runtime map over the embedded `DASHBOARD_BUNDLE_ASSETS`. `startDashboardServer` never builds on its own, so tests and the visual-QA script are untouched.

**Tech Stack:** Bun + TypeScript, `bun test`, Biome, Tailwind CSS v4 CLI, `Bun.build`.

---

## File Structure

- **Create** `src/cli/dashboard/source-bundle.ts` — source detection, mtime check, in-memory build, orchestration. New, focused module so `dashboard.ts` (already ~5700 lines) does not grow.
- **Create** `tests/cli/dashboard/source-bundle.test.ts` — unit/integration coverage for the new module.
- **Modify** `src/cli/commands/dashboard.ts` — thread `runtimeBundleAssets` through options/context, override in `serveDashboardBundleAsset`, call the orchestrator in `runDashboard`, banner copy.
- **Modify** `src/cli/specs.ts` — add `--no-build` flag + example to `DASHBOARD_SPEC`.
- **Modify** `tests/cli/commands/dashboard.test.ts` — integration test that a runtime override is served and that the no-override prod path still serves the embedded bundle.
- **Modify** `tests/fixtures/cli-help-snapshots/dashboard.txt` — regenerated for the new flag.
- **Modify** `CLAUDE.md` — document the new prod-from-source auto-build in the "Dashboard frontend development" section.

---

## Task 1: Source-build module — detection + mtime + RuntimeBundleAssets type

**Files:**
- Create: `src/cli/dashboard/source-bundle.ts`
- Test: `tests/cli/dashboard/source-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/dashboard/source-bundle.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bundleSourceIsNewer,
  dashboardSourceBuildContext,
  maxMtimeMsUnder,
} from '~/cli/dashboard/source-bundle.ts';

const tmps: string[] = [];
async function makeBase(opts: { tailwind: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'laurel-srcbundle-'));
  tmps.push(root);
  // baseDir is <root>/src/cli/dashboard so tailwindBin resolves to <root>/node_modules/.bin
  const base = join(root, 'src', 'cli', 'dashboard');
  await mkdir(join(base, 'web'), { recursive: true });
  await writeFile(join(base, 'web', 'entry.tsx'), 'export {};\n', 'utf8');
  await writeFile(join(base, 'web', 'styles.css'), '/* css */\n', 'utf8');
  await writeFile(join(base, 'bundled-assets.ts'), '// generated\n', 'utf8');
  if (opts.tailwind) {
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(root, 'node_modules', '.bin', 'tailwindcss'), '#!/bin/sh\n', 'utf8');
  }
  return base;
}

afterEach(async () => {
  for (const t of tmps.splice(0)) await rm(t, { recursive: true, force: true });
});

describe('dashboardSourceBuildContext', () => {
  test('returns a context when entry, styles, and tailwind are present', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    expect(ctx?.entry).toBe(join(base, 'web', 'entry.tsx'));
  });

  test('returns null when tailwind binary is absent', async () => {
    const base = await makeBase({ tailwind: false });
    expect(dashboardSourceBuildContext(base)).toBeNull();
  });
});

describe('mtime staleness', () => {
  test('bundleSourceIsNewer is true when a web file is newer than the embedded bundle', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    // bundled-assets.ts old, web entry new
    await utimes(ctx.bundledAssetsPath, new Date(1000), new Date(1000));
    await utimes(ctx.entry, new Date(5000), new Date(5000));
    expect(await bundleSourceIsNewer(ctx)).toBe(true);
  });

  test('bundleSourceIsNewer is false when the embedded bundle is newest', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    await utimes(ctx.entry, new Date(1000), new Date(1000));
    await utimes(join(ctx.webDir, 'styles.css'), new Date(1000), new Date(1000));
    await utimes(ctx.bundledAssetsPath, new Date(9000), new Date(9000));
    expect(await bundleSourceIsNewer(ctx)).toBe(false);
  });

  test('maxMtimeMsUnder returns 0 for a missing directory', async () => {
    expect(await maxMtimeMsUnder(join(tmpdir(), 'laurel-does-not-exist-xyz'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/dashboard/source-bundle.test.ts`
Expected: FAIL — `Cannot find module '~/cli/dashboard/source-bundle.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/dashboard/source-bundle.ts`:

```ts
import { type Dirent, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DashboardBundleAsset {
  contentType: string;
  body: string;
}

// Mirrors the shape of DASHBOARD_BUNDLE_ASSETS in bundled-assets.ts so the
// request handler can treat a runtime build and the embedded bundle the same.
export type RuntimeBundleAssets = Partial<Record<string, DashboardBundleAsset>>;

export interface DashboardSourceBuildContext {
  webDir: string;
  entry: string;
  styles: string;
  tailwindBin: string;
  bundledAssetsPath: string;
}

// This module lives at src/cli/dashboard/source-bundle.ts, so its own dir is
// the dashboard dir; the repo root (and node_modules) is three levels up.
const DEFAULT_BASE_DIR = dirname(fileURLToPath(import.meta.url));

export function dashboardSourceBuildContext(
  baseDir: string = DEFAULT_BASE_DIR,
): DashboardSourceBuildContext | null {
  const webDir = join(baseDir, 'web');
  const entry = join(webDir, 'entry.tsx');
  const styles = join(webDir, 'styles.css');
  const bundledAssetsPath = join(baseDir, 'bundled-assets.ts');
  const tailwindBin = join(baseDir, '..', '..', '..', 'node_modules', '.bin', 'tailwindcss');
  if (!existsSync(entry) || !existsSync(styles) || !existsSync(tailwindBin)) return null;
  return { webDir, entry, styles, tailwindBin, bundledAssetsPath };
}

export async function maxMtimeMsUnder(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let max = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, await maxMtimeMsUnder(full));
    } else {
      try {
        max = Math.max(max, (await stat(full)).mtimeMs);
      } catch {
        // unreadable entry: ignore, it cannot make the bundle stale on its own
      }
    }
  }
  return max;
}

export async function bundleSourceIsNewer(ctx: DashboardSourceBuildContext): Promise<boolean> {
  const webMtime = await maxMtimeMsUnder(ctx.webDir);
  let bundleMtime = 0;
  try {
    bundleMtime = (await stat(ctx.bundledAssetsPath)).mtimeMs;
  } catch {
    bundleMtime = 0;
  }
  return webMtime > bundleMtime;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/dashboard/source-bundle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/source-bundle.ts tests/cli/dashboard/source-bundle.test.ts
git commit -m "feat(dashboard): source-build detection and mtime staleness check"
```

---

## Task 2: In-memory bundle build + orchestrator

**Files:**
- Modify: `src/cli/dashboard/source-bundle.ts`
- Test: `tests/cli/dashboard/source-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/dashboard/source-bundle.test.ts`:

```ts
import {
  buildDashboardBundleInMemory,
  maybeAutoBuildDashboardBundle,
} from '~/cli/dashboard/source-bundle.ts';

describe('buildDashboardBundleInMemory (real repo source)', () => {
  test('builds non-empty JS and CSS from the actual dashboard source', async () => {
    const ctx = dashboardSourceBuildContext();
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    const assets = await buildDashboardBundleInMemory(ctx);
    expect(assets['/assets/dashboard.js']?.body.length ?? 0).toBeGreaterThan(0);
    expect(assets['/assets/dashboard.js']?.contentType).toContain('javascript');
    expect(assets['/assets/dashboard.css']?.body.length ?? 0).toBeGreaterThan(0);
    expect(assets['/assets/dashboard.css']?.contentType).toContain('css');
  }, 60_000);
});

describe('maybeAutoBuildDashboardBundle', () => {
  test('reports unavailable and skips building when --no-build is set', async () => {
    const result = await maybeAutoBuildDashboardBundle({ noBuild: true });
    expect(result.status).toBe('unavailable');
    expect(result.assets).toBeUndefined();
  });

  test('reports unavailable when there is no source context', async () => {
    const base = await makeBase({ tailwind: false });
    const result = await maybeAutoBuildDashboardBundle({ baseDir: base });
    expect(result.status).toBe('unavailable');
  });

  test('reports failed (not throw) when the tailwind binary is bogus', async () => {
    const base = await makeBase({ tailwind: true });
    const ctx = dashboardSourceBuildContext(base);
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    // entry newer than bundle so a build is attempted; the fake tailwind shell
    // script is not executable / does nothing useful, so the build fails.
    await utimes(ctx.bundledAssetsPath, new Date(1000), new Date(1000));
    await utimes(ctx.entry, new Date(5000), new Date(5000));
    const result = await maybeAutoBuildDashboardBundle({ baseDir: base });
    expect(result.status).toBe('failed');
    expect(result.assets).toBeUndefined();
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/dashboard/source-bundle.test.ts`
Expected: FAIL — `buildDashboardBundleInMemory`/`maybeAutoBuildDashboardBundle` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/cli/dashboard/source-bundle.ts`:

```ts
const JS_ASSET_PATH = '/assets/dashboard.js';
const CSS_ASSET_PATH = '/assets/dashboard.css';

export async function buildDashboardBundleInMemory(
  ctx: DashboardSourceBuildContext,
): Promise<RuntimeBundleAssets> {
  const built = await Bun.build({
    entrypoints: [ctx.entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
  });
  if (!built.success) {
    throw new Error(`dashboard JS build failed:\n${built.logs.map(String).join('\n')}`);
  }
  const jsOutput = built.outputs.find((o) => o.path.endsWith('.js')) ?? built.outputs[0];
  if (!jsOutput) throw new Error('dashboard JS build produced no output');
  const js = await jsOutput.text();

  // Tailwind v4 CLI writes to stdout when --output is omitted (default `-`).
  const proc = Bun.spawn([ctx.tailwindBin, '--input', ctx.styles, '--minify'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [css, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) {
    const err = (await new Response(proc.stderr).text()).trim();
    throw new Error(`dashboard CSS build failed (exit ${exitCode}): ${err}`);
  }
  if (css.trim().length === 0) {
    throw new Error('dashboard CSS build produced empty output');
  }

  return {
    [JS_ASSET_PATH]: { contentType: 'application/javascript; charset=utf-8', body: js },
    [CSS_ASSET_PATH]: { contentType: 'text/css; charset=utf-8', body: css },
  };
}

export type AutoBuildStatus = 'built' | 'fresh' | 'unavailable' | 'failed';

export interface AutoBuildResult {
  status: AutoBuildStatus;
  assets?: RuntimeBundleAssets;
  detail?: string;
}

// Prod-mode entrypoint: decide whether to build the dashboard frontend from
// source and return an in-memory asset map to serve. Never throws — a failed
// build degrades to the embedded bundle so the server still starts.
export async function maybeAutoBuildDashboardBundle(opts: {
  noBuild?: boolean;
  baseDir?: string;
}): Promise<AutoBuildResult> {
  if (opts.noBuild) return { status: 'unavailable', detail: 'auto-build skipped (--no-build)' };
  const ctx = dashboardSourceBuildContext(opts.baseDir);
  if (!ctx) return { status: 'unavailable' };
  try {
    if (!(await bundleSourceIsNewer(ctx))) return { status: 'fresh' };
    const assets = await buildDashboardBundleInMemory(ctx);
    return { status: 'built', assets };
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/dashboard/source-bundle.test.ts`
Expected: PASS (all tests). The real-source build test may take several seconds.

- [ ] **Step 5: Commit**

```bash
git add src/cli/dashboard/source-bundle.ts tests/cli/dashboard/source-bundle.test.ts
git commit -m "feat(dashboard): build dashboard bundle into memory with safe fallback"
```

---

## Task 3: Thread runtime override into the request context and asset handler

**Files:**
- Modify: `src/cli/commands/dashboard.ts` (import; `StartDashboardServerOptions`; `startDashboardServer` body + `buildCtx`; `DashboardRequestContext`; `serveDashboardBundleAsset`; its call site ~line 1417)
- Test: `tests/cli/commands/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `tests/cli/commands/dashboard.test.ts` (it already imports `startDashboardServer`; reuse the existing import). If a temp-project helper exists in that file, use it; otherwise this test only needs a cwd that `loadConfig` accepts — use the example project dir pattern already used by neighboring tests in the file:

```ts
describe('dashboard runtime bundle override', () => {
  test('serves a runtime override for /assets/dashboard.js and .css', async () => {
    const handle = await startDashboardServer({
      cwd: EXAMPLE_DIR, // reuse the same cwd constant other tests in this file use
      port: 0,
      host: '127.0.0.1',
      mode: 'prod',
      runtimeBundleAssets: {
        '/assets/dashboard.js': {
          contentType: 'application/javascript; charset=utf-8',
          body: 'console.log("override-js")',
        },
        '/assets/dashboard.css': {
          contentType: 'text/css; charset=utf-8',
          body: '.override{}',
        },
      },
    });
    try {
      const js = await fetch(`${handle.url}assets/dashboard.js`);
      expect(await js.text()).toBe('console.log("override-js")');
      const css = await fetch(`${handle.url}assets/dashboard.css`);
      expect(await css.text()).toBe('.override{}');
    } finally {
      await handle.stop();
    }
  });

  test('falls back to the embedded bundle when no override is supplied', async () => {
    const handle = await startDashboardServer({
      cwd: EXAMPLE_DIR,
      port: 0,
      host: '127.0.0.1',
      mode: 'prod',
    });
    try {
      const js = await fetch(`${handle.url}assets/dashboard.js`);
      // Embedded bundle is present in a built checkout; at minimum the route
      // resolves (200) or reports the documented empty-bundle 503 — never 404.
      expect([200, 503]).toContain(js.status);
    } finally {
      await handle.stop();
    }
  });
});
```

Note: confirm the constant name used for the example project cwd in this test file (e.g. `EXAMPLE_DIR`/`exampleDir`) by reading the top of `tests/cli/commands/dashboard.test.ts`, and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/commands/dashboard.test.ts -t "runtime bundle override"`
Expected: FAIL — `runtimeBundleAssets` is not an accepted option (type error) / override not served.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/commands/dashboard.ts`:

3a. Add the import near the other `../dashboard/*` imports (after the `bundled-assets.ts` import at line 84):

```ts
import {
  type AutoBuildResult,
  type RuntimeBundleAssets,
  maybeAutoBuildDashboardBundle,
} from '../dashboard/source-bundle.ts';
```

3b. Extend `StartDashboardServerOptions` (currently ends with `mode: DashboardServerMode;`):

```ts
interface StartDashboardServerOptions {
  cwd: string;
  configPath?: string;
  port: number;
  host: string;
  mode: DashboardServerMode;
  runtimeBundleAssets?: RuntimeBundleAssets;
}
```

3c. In `startDashboardServer`, destructure and forward into the request context. Change the destructure line and the `buildCtx` return:

```ts
  const { cwd, configPath, port, host, mode, runtimeBundleAssets } = options;
```

```ts
  const buildCtx = (request: Request): DashboardRequestContext => ({
    cwd,
    configPath,
    changeBus,
    watch: watchSetup,
    mode,
    runtimeBundleAssets,
    security: {
      origin: new URL(request.url).origin,
      token,
      lanExposed,
    },
  });
```

3d. Extend `DashboardRequestContext`:

```ts
interface DashboardRequestContext {
  cwd: string;
  configPath?: string;
  changeBus: ChangeBus;
  watch?: DashboardWatchMetadata;
  security?: DashboardSecurityContext;
  maxBodyBytes?: number;
  mode?: DashboardServerMode;
  runtimeBundleAssets?: RuntimeBundleAssets;
}
```

3e. Update the asset call site (currently `return serveDashboardBundleAsset(url.pathname);` around line 1417):

```ts
      return serveDashboardBundleAsset(url.pathname, ctx.runtimeBundleAssets);
```

3f. Update `serveDashboardBundleAsset` to prefer the override:

```ts
async function serveDashboardBundleAsset(
  pathname: string,
  override?: RuntimeBundleAssets,
): Promise<Response> {
  const asset =
    override?.[pathname] ??
    DASHBOARD_BUNDLE_ASSETS[pathname as keyof typeof DASHBOARD_BUNDLE_ASSETS];
  if (!asset) return new Response('Not Found', { status: 404 });
  if (asset.body === '') {
    return new Response(
      'Dashboard bundle is empty. Run `bun run build:dashboard-bundle` before starting the dashboard.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
  return new Response(asset.body, {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
    },
  });
}
```

(The `AutoBuildResult` import is consumed in Task 4; leaving it imported now is fine, but if Biome flags an unused import, add it together with Task 4 instead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/commands/dashboard.test.ts -t "runtime bundle override"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/dashboard.ts tests/cli/commands/dashboard.test.ts
git commit -m "feat(dashboard): serve runtime bundle override ahead of embedded bundle"
```

---

## Task 4: Wire auto-build into runDashboard + `--no-build` flag + banner

**Files:**
- Modify: `src/cli/specs.ts` (`DASHBOARD_SPEC.options` + `examples`)
- Modify: `src/cli/commands/dashboard.ts` (`runDashboard`: parse flag, run orchestrator before the banner, set `bundleLabel`, warn on failure, pass override to `startDashboardServer`)

- [ ] **Step 1: Add the `--no-build` flag to the spec**

In `src/cli/specs.ts`, inside `DASHBOARD_SPEC.options`, add immediately after the `dev` option block:

```ts
    'no-build': {
      type: 'boolean',
      description:
        'Skip the prod-from-source auto-build and serve the embedded/pre-built bundle as-is (fast restart; no effect on --dev or the published CLI)',
    },
```

And add an example to `DASHBOARD_SPEC.examples` (after the `--dev` example):

```ts
    'laurel dashboard --no-build                  # serve the embedded bundle without rebuilding',
```

- [ ] **Step 2: Implement the runDashboard wiring**

In `src/cli/commands/dashboard.ts`, in `runDashboard`, the current code computes `bundleLabel` then renders the banner then calls `startDashboardServer`. Replace the `const bundleLabel = ...` line and the `startDashboardServer({ ... })` call so an auto-build runs first.

Replace:

```ts
  const bundleLabel =
    mode === 'dev' ? 'bun fullstack dev server (HMR)' : 'dist/dashboard-bundle/ (pre-built)';
```

with:

```ts
  let runtimeBundleAssets: RuntimeBundleAssets | undefined;
  let autoBuild: AutoBuildResult | undefined;
  if (mode === 'prod') {
    autoBuild = await maybeAutoBuildDashboardBundle({ noBuild: parsed.values['no-build'] === true });
    runtimeBundleAssets = autoBuild.assets;
  }
  const bundleLabel =
    mode === 'dev'
      ? 'bun fullstack dev server (HMR)'
      : autoBuild?.status === 'built'
        ? 'built from source (web/**)'
        : autoBuild?.status === 'fresh'
          ? 'dist/dashboard-bundle/ (embedded; source unchanged)'
          : autoBuild?.status === 'failed'
            ? 'dist/dashboard-bundle/ (embedded; auto-build failed)'
            : 'dist/dashboard-bundle/ (pre-built)';
```

Then update the server start to pass the override (currently `await startDashboardServer({ cwd, configPath, port, host, mode })`):

```ts
    handle = await startDashboardServer({ cwd, configPath, port, host, mode, runtimeBundleAssets });
```

- [ ] **Step 3: Surface a warning when the auto-build failed**

In `runDashboard`, after the existing `mode === 'dev'` notice block (the Bun segfault warning), add:

```ts
  if (autoBuild?.status === 'failed') {
    writeBlock(
      renderNotice(
        'warning',
        `Dashboard auto-build from source failed; serving the embedded bundle. ${autoBuild.detail ?? ''}`.trim(),
      ),
    );
  }
  if (autoBuild?.status === 'built') {
    writeBlock(
      renderNotice('info', 'Rebuilt the dashboard frontend from source. Use --dev for live hot reload.'),
    );
  }
```

- [ ] **Step 4: Verify the build wiring compiles and behaves**

Run (typecheck + the existing dashboard suite, delegated per repo convention — see Task 6 for the delegated full check):

`bun test tests/cli/commands/dashboard.test.ts`
Expected: PASS (existing tests + Task 3 tests still green).

Manual smoke (optional, from repo root): `bun run src/cli/index.ts dashboard --port 0` should print `Bundle  built from source (web/**)` on first run after editing a `web/**` file, and `--no-build` should print the embedded-bundle label.

- [ ] **Step 5: Commit**

```bash
git add src/cli/specs.ts src/cli/commands/dashboard.ts
git commit -m "feat(dashboard): auto-build prod bundle from source with --no-build escape hatch"
```

---

## Task 5: Regenerate the CLI help snapshot

**Files:**
- Modify: `tests/fixtures/cli-help-snapshots/dashboard.txt`

- [ ] **Step 1: Run the snapshot test to confirm it now fails**

Run: `bun test tests/cli/help-snapshots.test.ts -t "dashboard --help"`
Expected: FAIL — stdout now includes `--no-build`, so it differs from the committed fixture.

- [ ] **Step 2: Regenerate the fixture**

Run (applies the same version normalization the test uses, then writes the fixture):

```bash
NO_COLOR=1 LAUREL_NO_COLOR=1 FORCE_COLOR=0 bun run src/cli/index.ts dashboard --help \
  | sed -E 's/^laurel [0-9]+\.[0-9]+\.[0-9]+$/laurel <version>/; s/(Laurel) [0-9]+\.[0-9]+\.[0-9]+/\1 <version>/g' \
  > tests/fixtures/cli-help-snapshots/dashboard.txt
```

- [ ] **Step 3: Run the snapshot test to verify it passes**

Run: `bun test tests/cli/help-snapshots.test.ts -t "dashboard"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/cli-help-snapshots/dashboard.txt
git commit -m "test(dashboard): regenerate help snapshot for --no-build"
```

---

## Task 6: Update CLAUDE.md + full verification

**Files:**
- Modify: `CLAUDE.md` ("Dashboard frontend development" section)

- [ ] **Step 1: Edit the CLAUDE.md section**

In `CLAUDE.md`, in the "## Dashboard frontend development" section, replace the bullet that currently begins "`bun run src/cli/index.ts dashboard` (no flag) continues to serve the pre-built bundle from `dist/dashboard-bundle/`..." with:

```markdown
- `bun run src/cli/index.ts dashboard` (no flag), when run from a repo source
  checkout, now auto-builds the frontend bundle into memory at startup if any
  `src/cli/dashboard/web/**` file is newer than the embedded
  `src/cli/dashboard/bundled-assets.ts` (mtime fast path skips the rebuild when
  the source is unchanged). So a plain `laurel dashboard` reflects your latest
  `web/**` edits without a manual `build-dashboard-bundle.ts` run. Pass
  `--no-build` to skip the auto-build and serve the embedded bundle as-is. The
  published npm CLI / compiled binary has no `web/**` source or tailwind, so it
  always serves the embedded `dist/dashboard-bundle/` bundle (unchanged).
- For live hot reload while editing, `--dev` (Bun fullstack HMR) is still the
  path; the auto-build only refreshes once per launch.
```

Then update the later "After rebuilding the bundle, RESTART any running prod dashboard" bullet to clarify it now applies only to the explicit `build-dashboard-bundle.ts` / published-bundle workflow, not to a plain source-run `laurel dashboard` (which rebuilds on launch). Change its first sentence to:

```markdown
- **When you run `scripts/build-dashboard-bundle.ts` and serve the committed
  `dist/dashboard-bundle/` (the published-CLI path), RESTART any running prod
  dashboard.** A plain source-run `laurel dashboard` rebuilds on launch, so this
  only bites the explicit-bundle workflow.
```

(Keep the remainder of that bullet — the in-memory/startup explanation — intact.)

- [ ] **Step 2: Run the full delegated check**

Per repo convention, delegate lint/typecheck/test to a sonnet subagent and receive only the result. The commands the subagent runs:

```bash
bun run check
bun test
```

Expected: both green. (`bun run check` is Biome lint+format; `bun test` is the full suite including the new `source-bundle.test.ts` and the dashboard tests.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document dashboard prod-from-source auto-build in CLAUDE.md"
```

---

## Self-Review

- **Spec coverage:**
  - Source-run detection → Task 1 (`dashboardSourceBuildContext`).
  - Auto-build into memory (Bun.build + tailwind) → Task 2 (`buildDashboardBundleInMemory`).
  - mtime fast path → Task 1/2 (`bundleSourceIsNewer`, used by `maybeAutoBuildDashboardBundle`).
  - Runtime override preferred over embedded, with fallback → Task 3 (`serveDashboardBundleAsset`).
  - `startDashboardServer` never auto-builds (tests/visual-qa safe) → Task 3 (option defaults to undefined; build only invoked in `runDashboard`).
  - `--no-build` flag → Task 4 + Task 5 snapshot.
  - Banner copy + `--dev` hint + failure warning → Task 4.
  - Failure handling never crashes the server → Task 2 (`maybeAutoBuildDashboardBundle` catches) + Task 4 warn notice.
  - Published-binary unchanged → Task 1 returns null when source/tailwind absent.
  - CLAUDE.md update → Task 6.
  - Tests for detection/mtime/build/override/no-override → Tasks 1–3.
- **Placeholder scan:** none — every code step contains full code; the only "confirm the constant name" note (Task 3 Step 1) is an explicit instruction to match an existing identifier, with the fix shown.
- **Type consistency:** `RuntimeBundleAssets`, `DashboardBundleAsset`, `DashboardSourceBuildContext`, `AutoBuildResult`/`AutoBuildStatus` are defined in Task 1–2 and used with the same names/shapes in Tasks 3–4. `runtimeBundleAssets` option/field name is consistent across `StartDashboardServerOptions`, `DashboardRequestContext`, `buildCtx`, and the `runDashboard` call. Asset keys `'/assets/dashboard.js'` / `'/assets/dashboard.css'` match the prod HTML shell in `html.ts` and the embedded `DASHBOARD_BUNDLE_ASSETS` keys.
```
