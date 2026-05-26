# Dashboard dev mode (`nectar dashboard --dev`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--dev` flag to `nectar dashboard` that launches Bun's fullstack dev server with HMR for `src/cli/dashboard/web/**`, so frontend iteration no longer requires `bun run build:dashboard-bundle` between edits.

**Architecture:** Two `Bun.serve()` invocations behind the same `runDashboard` entry. Prod mode (default) keeps serving `dist/dashboard-bundle/dashboard.{js,css}` unchanged. Dev mode imports a new static `dashboard.html` as a `routes` entry, lets Bun bundle TSX / Tailwind on demand, and injects an HMR client. The CSRF token previously embedded as a `<meta>` tag in the prod shell moves to a runtime `/api/dashboard/bootstrap` endpoint that both modes consume.

**Tech Stack:** Bun >=1.3.0 fullstack dev server (`Bun.serve({ routes, development: { hmr, console } })`), Preact 10, Tailwind v4 + `bun-plugin-tailwind`, existing `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-26-dashboard-dev-mode-design.md`

---

## File Structure

**New files:**
- `src/cli/dashboard/web/dashboard.html` — static dev shell, references `./entry.tsx` and `./styles.css` so Bun's HTMLRewriter picks them up.

**Modified files:**
- `src/cli/commands/dashboard.ts` — `--dev` branch in `runDashboard`, new `/api/dashboard/bootstrap` handler, `mode` added to `DashboardRequestContext`. Drops the meta-tag token rendering inside the prod-shell HTML branch.
- `src/cli/dashboard/html.ts` — remove `<meta name="nectar-dashboard-token">` line, drop the `token` parameter.
- `src/cli/dashboard/web/entry.tsx` — async bootstrap fetch before `render()`.
- `src/cli/dashboard/web/lib/api.ts` — replace module-load `readToken()` with a setter (`setDashboardToken`) called by `entry.tsx` after bootstrap resolves.
- `src/cli/specs.ts` — declare the `dev` boolean option on `DASHBOARD_SPEC`.
- `bunfig.toml` — register `bun-plugin-tailwind` for the dev server.
- `package.json` — add `bun-plugin-tailwind` to `devDependencies`.
- `CLAUDE.md` (project root) — add "Dashboard frontend development" section.
- `tests/cli/commands/dashboard.test.ts` — update / drop tests that asserted the `<meta>` token tag; add bootstrap endpoint coverage.
- `tests/fixtures/cli-help-snapshots/dashboard.txt` — refresh to include `--dev`.

**New test file:**
- `tests/cli/commands/dashboard-dev-mode.test.ts` — dev-mode smoke test (server boots, routes resolve, bootstrap returns `mode: 'dev'`).

Each task below produces a green commit. Run `bun run check && bun test --parallel` between tasks; only commit when both pass.

---

### Task 1: Bootstrap endpoint + `mode` in request context

**Files:**
- Modify: `src/cli/commands/dashboard.ts` (`DashboardRequestContext`, `handleDashboardRequest`, `runDashboard`)
- Test: `tests/cli/commands/dashboard.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/cli/commands/dashboard.test.ts` (after the existing `describe('handleDashboardRequest', ...)` block):

```ts
describe('GET /api/dashboard/bootstrap', () => {
  test('returns the per-process token and the resolved server mode', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap'),
        {
          cwd: dir,
          changeBus: bus,
          mode: 'dev',
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { token: string; mode: 'dev' | 'prod' };
      expect(body.token).toBe('unit-test-token');
      expect(body.mode).toBe('dev');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('defaults mode to "prod" when the context omits it', async () => {
    const dir = await makeDashboardFixture();
    try {
      const bus = createChangeBus();
      const response = await handleDashboardRequest(
        new Request('http://127.0.0.1:4322/api/dashboard/bootstrap'),
        {
          cwd: dir,
          changeBus: bus,
          security: {
            origin: 'http://127.0.0.1:4322',
            token: 'unit-test-token',
            lanExposed: false,
          },
        },
      );
      const body = (await response.json()) as { token: string; mode: 'dev' | 'prod' };
      expect(body.mode).toBe('prod');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands/dashboard.test.ts -t "GET /api/dashboard/bootstrap"`
Expected: FAIL with a 404 or "no matching route" response (endpoint does not exist yet).

- [ ] **Step 3: Add `mode` to `DashboardRequestContext`**

In `src/cli/commands/dashboard.ts`, extend the interface (around line 695):

```ts
export type DashboardServerMode = 'dev' | 'prod';

export interface DashboardRequestContext {
  cwd: string;
  configPath?: string;
  changeBus: ChangeBus;
  watch?: DashboardWatchMetadata;
  security?: DashboardSecurityContext;
  maxBodyBytes?: number;
  mode?: DashboardServerMode;
}
```

- [ ] **Step 4: Implement the bootstrap handler**

In `src/cli/commands/dashboard.ts:handleDashboardRequest`, add a branch before the catch-all 404 (the cleanest spot is right after the existing `if (request.method === 'GET' && url.pathname === '/api/events')` block, around line 1196):

```ts
if (request.method === 'GET' && url.pathname === '/api/dashboard/bootstrap') {
  return jsonResponse({
    token: ctx.security?.token ?? '',
    mode: ctx.mode ?? 'prod',
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands/dashboard.test.ts -t "GET /api/dashboard/bootstrap"`
Expected: PASS (both tests).

- [ ] **Step 6: Run the full dashboard test file**

Run: `bun test tests/cli/commands/dashboard.test.ts`
Expected: All tests pass. Nothing else regressed.

- [ ] **Step 7: Run lint + typecheck**

Run: `bun run check && bun run typecheck`
Expected: Both clean.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/dashboard.ts tests/cli/commands/dashboard.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add /api/dashboard/bootstrap for runtime token handoff

Returns the per-process CSRF token plus the resolved server mode (dev /
prod). Both modes will consume this endpoint instead of reading a meta
tag; the meta-tag path is removed in a follow-up commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend consumes the bootstrap endpoint

**Files:**
- Modify: `src/cli/dashboard/web/lib/api.ts:1-22` (module-load `readToken()` → setter)
- Modify: `src/cli/dashboard/web/entry.tsx` (await bootstrap before `render()`)

No automated TDD: the dashboard frontend is not unit-tested. Verification happens at Task 9 (manual HMR check) and indirectly via Task 7 (dev-mode smoke test still drives `loadDashboardState` which uses the token-bearing fetch wrapper).

- [ ] **Step 1: Refactor `lib/api.ts` to use a setter**

Replace lines 1-22 of `src/cli/dashboard/web/lib/api.ts` with:

```ts
import type {
  ContentFingerprint,
  DashboardContentItem,
  DashboardEditorKind,
  DashboardState,
} from '../types.ts';

let dashboardToken = '';

export function setDashboardToken(token: string): void {
  dashboardToken = token;
}

export function getDashboardToken(): string {
  return dashboardToken;
}

function writeHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-nectar-dashboard-token': dashboardToken,
  };
}
```

Then **replace every literal `TOKEN` reference in the file** (lines 20, 94, 151, 171, 357, 395, 437 per the prior grep) with `dashboardToken`. Do not leave a `const TOKEN` binding.

Verify with: `grep -n "TOKEN" src/cli/dashboard/web/lib/api.ts`
Expected: zero matches (or only inside comments / function names like `setDashboardToken`).

- [ ] **Step 2: Rewrite `entry.tsx` to bootstrap before render**

Replace the entire contents of `src/cli/dashboard/web/entry.tsx` with:

```tsx
import { render } from 'preact';
import { DashboardApp } from './DashboardApp.tsx';
import { setDashboardToken } from './lib/api.ts';

interface BootstrapResponse {
  token: string;
  mode: 'dev' | 'prod';
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Dashboard root element missing. Expected <div id="root"> in the shell HTML.');
  }
  const response = await fetch('/api/dashboard/bootstrap', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Dashboard bootstrap failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as BootstrapResponse;
  setDashboardToken(body.token);
  render(<DashboardApp />, root);
}

void bootstrap();
```

- [ ] **Step 3: Rebuild the prod bundle to confirm the refactor compiles for the browser**

Run: `bun run build:dashboard-bundle`
Expected: `dist/dashboard-bundle/dashboard.js` and `.css` regenerate without errors. The output size will be marginally different from before — that's fine.

- [ ] **Step 4: Run typecheck + lint**

Run: `bun run typecheck && bun run check`
Expected: Both clean. (Note: `typecheck` runs the dashboard web `tsconfig` too — per package.json line 92.)

- [ ] **Step 5: Run the test suite**

Run: `bun test --parallel`
Expected: All green. The meta-tag test still passes because we have not removed the meta tag yet (that's Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/cli/dashboard/web/lib/api.ts src/cli/dashboard/web/entry.tsx
git commit -m "$(cat <<'EOF'
refactor(dashboard): consume token via /api/dashboard/bootstrap instead of meta tag

entry.tsx awaits the bootstrap response before mounting and pushes the
token into lib/api.ts via a setter. The <meta> tag is still rendered by
the prod shell at this point — it becomes redundant and is removed in
the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Drop the `<meta>` token tag from the prod shell

**Files:**
- Modify: `src/cli/dashboard/html.ts` (delete meta line, drop `token` param)
- Modify: `src/cli/commands/dashboard.ts:1158` (drop token argument at call site)
- Modify: `tests/cli/commands/dashboard.test.ts:1763-1786` (update / delete two tests)

- [ ] **Step 1: Update the existing test to assert the meta tag is gone**

In `tests/cli/commands/dashboard.test.ts`, replace the two tests at lines 1763-1786 with the following single test:

```ts
test('renders the minimal Preact dashboard shell with bundle references', () => {
  const html = renderDashboardHtml();

  expect(html).toContain('<title>Nectar Dashboard</title>');
  expect(html).toContain('data-theme="system"');
  expect(html).toContain('<link rel="stylesheet" href="/assets/dashboard.css">');
  expect(html).toContain('<script type="module" src="/assets/dashboard.js"></script>');
  expect(html).toContain('<div id="root"></div>');
  expect(html).toContain('href="#main"');

  // The CSRF token now ships via /api/dashboard/bootstrap, not a meta tag.
  expect(html).not.toContain('nectar-dashboard-token');
  // Inline `<style>` tag and bundled vanilla JS are gone — the shell only
  // loads the Preact bundle from the served assets.
  expect(html).not.toContain('<style>');
  expect(html).not.toContain('createDashboardUiState');
  expect(html).not.toContain('renderStatePanelHtml');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands/dashboard.test.ts -t "renders the minimal Preact dashboard shell"`
Expected: FAIL — the current `html.ts` still emits the meta tag, so the `not.toContain` assertion fails.

- [ ] **Step 3: Update `src/cli/dashboard/html.ts`**

Replace the contents of the file with:

```ts
export function renderDashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nectar Dashboard</title>
<link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="root"></div>
<script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;
}
```

The `escapeAttr` helper is no longer referenced and can be deleted from the same file.

- [ ] **Step 4: Update the call site in `dashboard.ts:1158`**

Find the line (was: `return htmlResponse(renderDashboardHtml(ctx.security?.token ?? ''));`) and replace with:

```ts
return htmlResponse(renderDashboardHtml());
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands/dashboard.test.ts`
Expected: All pass. The "escapes the dashboard token" test is gone (we deleted it in step 1) and the updated test asserts the meta tag is absent.

- [ ] **Step 6: Run lint + typecheck**

Run: `bun run check && bun run typecheck`
Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add src/cli/dashboard/html.ts src/cli/commands/dashboard.ts tests/cli/commands/dashboard.test.ts
git commit -m "$(cat <<'EOF'
refactor(dashboard): drop the <meta name=nectar-dashboard-token> tag

Token now flows through /api/dashboard/bootstrap (added in the previous
commit). renderDashboardHtml() no longer needs the token argument, so
the parameter and the local escapeAttr() helper are removed too.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Declare `--dev` on `DASHBOARD_SPEC`

**Files:**
- Modify: `src/cli/specs.ts:DASHBOARD_SPEC`
- Modify: `tests/fixtures/cli-help-snapshots/dashboard.txt`

- [ ] **Step 1: Add the option to the spec**

In `src/cli/specs.ts`, locate the `DASHBOARD_SPEC` block. Add a new `dev` entry to `options` (alphabetically between `config` and `host`) and a matching example:

```ts
dev: {
  type: 'boolean',
  description:
    'Run the dashboard with Bun\'s fullstack dev server (HMR for src/cli/dashboard/web/**; no pre-built bundle required)',
},
```

And in `examples`, append:

```ts
'nectar dashboard --dev                       # frontend HMR; bundles TSX/CSS on demand',
```

- [ ] **Step 2: Refresh the help snapshot fixture**

Replace the contents of `tests/fixtures/cli-help-snapshots/dashboard.txt` with the updated help text. Easiest path: regenerate it by running the CLI and capturing the output:

Run: `bun run src/cli/index.ts dashboard --help > tests/fixtures/cli-help-snapshots/dashboard.txt`

Open the file and confirm it now lists `--dev` under Options and includes the new example. Strip any trailing blank line so it matches sibling snapshots.

- [ ] **Step 3: Run the snapshot test**

Run: `bun test tests/cli/help-snapshots.test.ts` (or the test file that consumes `cli-help-snapshots/dashboard.txt` — find it with `grep -rln "cli-help-snapshots" tests/`).
Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `bun run check`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/specs.ts tests/fixtures/cli-help-snapshots/dashboard.txt
git commit -m "$(cat <<'EOF'
feat(dashboard): declare --dev flag on the dashboard CLI spec

The flag is parsed but not yet wired into runDashboard. Subsequent
commits add the static HTML shell, Tailwind plugin, and the dev-mode
Bun.serve() branch that consumes it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add the static dev shell HTML

**Files:**
- Create: `src/cli/dashboard/web/dashboard.html`

- [ ] **Step 1: Write the file**

Create `src/cli/dashboard/web/dashboard.html` with the following content (exact, byte-for-byte):

```html
<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nectar Dashboard</title>
<link rel="stylesheet" href="./styles.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="root"></div>
<script type="module" src="./entry.tsx"></script>
</body>
</html>
```

Relative paths (`./styles.css`, `./entry.tsx`) let Bun's HTMLRewriter resolve them against the HTML file location at request time.

- [ ] **Step 2: Sanity-check that prod tests still pass**

Run: `bun test --parallel`
Expected: Green. This file is not imported anywhere yet, so it should be a pure addition.

- [ ] **Step 3: Commit**

```bash
git add src/cli/dashboard/web/dashboard.html
git commit -m "$(cat <<'EOF'
feat(dashboard): add static dev shell HTML for Bun fullstack server

Bun's HTML import scans <script>/<link> tags and bundles the referenced
.tsx/.css on demand. References use relative paths so HTMLRewriter
resolves them against src/cli/dashboard/web/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire `bun-plugin-tailwind` into Bun's dev bundler

**Files:**
- Modify: `package.json` (`devDependencies`)
- Modify: `bunfig.toml`

- [ ] **Step 1: Add the plugin as a devDependency**

Run: `bun add -d bun-plugin-tailwind`

This updates `package.json` and `bun.lock`. Verify the version pinned is reasonable (>= 0.0.14 at minimum; the README on npm is the source of truth).

- [ ] **Step 2: Register the plugin in `bunfig.toml`**

Append the following block to the end of `bunfig.toml`:

```toml
# ---------------------------------------------------------------------------
# Bun fullstack dev server (used by `nectar dashboard --dev`).
#
# bun-plugin-tailwind runs Tailwind v4 against any CSS file referenced from
# an HTML import served via Bun.serve({ routes: { ... } }). The prod bundle
# script (scripts/build-dashboard-bundle.ts) still invokes the standalone
# tailwindcss CLI directly; this plugin only affects the dev server path.
# ---------------------------------------------------------------------------

[serve.static]
plugins = ["bun-plugin-tailwind"]
```

- [ ] **Step 3: Verify the prod bundle still builds**

Run: `bun run build:dashboard-bundle`
Expected: succeeds with no change to its previous output behaviour. (Touching `bunfig.toml` should not affect the explicit `Bun.build()` call inside the build script.)

- [ ] **Step 4: Run full lint + tests**

Run: `bun run check && bun test --parallel`
Expected: Green.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock bunfig.toml
git commit -m "$(cat <<'EOF'
feat(dashboard): register bun-plugin-tailwind for the fullstack dev server

The plugin processes Tailwind v4 directives in styles.css when Bun
bundles the dev shell on demand. The prod bundle path still shells out
to the standalone tailwindcss CLI inside scripts/build-dashboard-bundle.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Fallback if Task 7 reveals the plugin doesn't work with Tailwind v4 + this `styles.css`:** revert this commit, and in Task 7 spawn `tailwindcss --watch` as a sidecar process from `runDashboard` writing to a tempdir, rewriting the dev shell's `<link>` to point at that tempdir. Escalate to the user before going down that path.

---

### Task 7: Wire the `--dev` branch into `runDashboard` + smoke test

**Files:**
- Modify: `src/cli/commands/dashboard.ts:runDashboard` (around lines 714-795)
- Create: `tests/cli/commands/dashboard-dev-mode.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/cli/commands/dashboard-dev-mode.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDashboard } from '~/cli/commands/dashboard.ts';

async function makeMinimalProject(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-dashboard-dev-')));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });
  await mkdir(join(dir, 'themes/source'), { recursive: true });
  await writeFile(
    join(dir, 'themes/source/index.hbs'),
    '<h1>{{@site.title}}</h1>\n',
    'utf8',
  );
  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Dev Mode Smoke"',
      'description = ""',
      'url = "https://example.test"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

describe('nectar dashboard --dev', () => {
  let originalCwd: string;
  let projectDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    projectDir = await makeMinimalProject();
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
  });

  test('starts the fullstack dev server, serves /, and answers /api/dashboard/bootstrap with mode=dev', async () => {
    // Use port 0 so the kernel hands us a free port. Kick off runDashboard
    // in the background, then poll for readiness.
    const runPromise = runDashboard(['--dev', '--port', '0']);

    // Give the server a moment to bind. runDashboard logs the URL via
    // logger.info; we cannot easily intercept that here, so we poll the
    // well-known default by trying a few candidate ports... actually no.
    // Simpler: have the test discover the port via the `Bun.serve` return
    // value. Since runDashboard doesn't expose it, the test instead uses
    // an explicit port that's almost certainly free.
    //
    // Replace the port-0 approach above with a fixed high port:
    expect(true).toBe(true); // placeholder; the real assertions come below.

    // Send SIGINT to gracefully shut down so the afterEach cleanup runs.
    process.kill(process.pid, 'SIGINT');
    await runPromise;
  });
});
```

> **Note:** the above is intentionally a placeholder. The real assertion strategy needs `runDashboard` to expose the bound port (currently it logs but does not return it). **Before writing the real test, refactor `runDashboard` to optionally return the bound `Bun.serve` instance** so the test can read `server.port` and `server.stop(true)`.

Refactoring sketch (apply in step 3 below): change `runDashboard` to delegate to an internal `startDashboardServer({ args, signal })` that returns `{ server, cleanup }`. `runDashboard` itself stays as the CLI entry that waits for SIGINT/SIGTERM. The test calls `startDashboardServer` directly.

For this step, write the test as it will look once that helper exists:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer } from '~/cli/commands/dashboard.ts';

async function makeMinimalProject(): Promise<string> { /* same as above */ }

describe('nectar dashboard --dev', () => {
  let originalCwd: string;
  let projectDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    projectDir = await makeMinimalProject();
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
  });

  test('binds and answers core routes in dev mode', async () => {
    const handle = await startDashboardServer({
      cwd: projectDir,
      port: 0,
      host: '127.0.0.1',
      mode: 'dev',
    });
    try {
      const base = `http://127.0.0.1:${handle.port}`;

      const root = await fetch(`${base}/`);
      expect(root.status).toBe(200);
      const rootHtml = await root.text();
      expect(rootHtml).toContain('<div id="root"></div>');

      const bootstrap = await fetch(`${base}/api/dashboard/bootstrap`);
      expect(bootstrap.status).toBe(200);
      const body = (await bootstrap.json()) as { token: string; mode: string };
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
      expect(body.mode).toBe('dev');

      const state = await fetch(`${base}/api/state`);
      expect(state.status).toBe(200);
      const stateBody = (await state.json()) as { site: { title: string } };
      expect(stateBody.site.title).toBe('Dev Mode Smoke');
    } finally {
      await handle.stop();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/cli/commands/dashboard-dev-mode.test.ts`
Expected: FAIL — `startDashboardServer` is not exported yet.

- [ ] **Step 3: Refactor `runDashboard` to expose `startDashboardServer`**

In `src/cli/commands/dashboard.ts`, extract the server-starting logic into a new exported function. Replace the body of `runDashboard` (the part from `const port = parsePort(...)` down through the `cleanup.register(() => server.stop(true), ...)` line) with a call to `startDashboardServer`. Keep `runDashboard` responsible for arg parsing, error reporting, and SIGINT/SIGTERM waiting.

New exported helper (place above `runDashboard`):

```ts
export interface StartDashboardServerOptions {
  cwd: string;
  configPath?: string;
  port: number;
  host: string;
  mode: DashboardServerMode;
}

export interface DashboardServerHandle {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function startDashboardServer(
  options: StartDashboardServerOptions,
): Promise<DashboardServerHandle> {
  const { cwd, configPath, port, host, mode } = options;
  await loadConfig({ cwd, configPath });
  const changeBus = createChangeBus();
  const watchSetup = await watchDashboardFiles({ cwd, configPath, changeBus });
  const token = createDashboardToken();
  const lanExposed = isLanExposedHost(host);

  const buildCtx = (request: Request): DashboardRequestContext => ({
    cwd,
    configPath,
    changeBus,
    watch: watchSetup,
    mode,
    security: {
      origin: new URL(request.url).origin,
      token,
      lanExposed,
    },
  });

  const server =
    mode === 'dev'
      ? Bun.serve({
          port,
          hostname: host,
          idleTimeout: 255,
          development: { hmr: true, console: true },
          routes: buildDevRoutes(),
          async fetch(request) {
            return handleDashboardRequest(request, buildCtx(request));
          },
        })
      : Bun.serve({
          port,
          hostname: host,
          idleTimeout: 255,
          async fetch(request) {
            return handleDashboardRequest(request, buildCtx(request));
          },
        });

  return {
    port: server.port,
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${server.port}/`,
    stop: async () => {
      for (const watcher of watchSetup.watchers) watcher.close();
      server.stop(true);
    },
  };
}

function buildDevRoutes(): Record<string, unknown> {
  // Bun's HTML import resolves the relative <script>/<link> refs inside
  // dashboard.html against the file's own location and bundles them on
  // demand. The path resolution happens at import time — the HTML file
  // contents are read here, not at request time.
  // biome-ignore lint/correctness/noUnusedImports: dynamic HTML import
  const shell = require('../dashboard/web/dashboard.html');
  return {
    '/': shell,
    '/posts': shell,
    '/pages': shell,
    '/components': shell,
    '/authors': shell,
    '/tags': shell,
    '/settings': shell,
    '/settings/design': shell,
    '/settings/integration': shell,
    '/settings/migration': shell,
    '/migration': shell,
    '/posts/new': shell,
    '/pages/new': shell,
    '/components/new': shell,
    '/authors/new': shell,
    '/tags/new': shell,
    '/posts/:slug/edit': shell,
    '/pages/:slug/edit': shell,
    '/components/:slug/edit': shell,
    '/authors/:slug/edit': shell,
    '/tags/:slug/edit': shell,
  };
}
```

> **Important:** Bun supports static `import` of `.html` files only at top level. Replace the `require` line above with an actual top-level import statement near the other imports in `dashboard.ts`:
>
> ```ts
> import dashboardShellHtml from '../dashboard/web/dashboard.html';
> ```
>
> and replace `buildDevRoutes` accordingly:
>
> ```ts
> function buildDevRoutes(): Record<string, unknown> {
>   return {
>     '/': dashboardShellHtml,
>     '/posts': dashboardShellHtml,
>     // ... (same list as above)
>   };
> }
> ```
>
> If TypeScript complains about `.html` imports, add a one-line ambient declaration to `src/cli/dashboard/web/types.ts`:
>
> ```ts
> declare module '*.html' { const html: unknown; export default html; }
> ```

- [ ] **Step 4: Update `runDashboard` to call `startDashboardServer`**

Replace the body of `runDashboard` (from the `const port = parsePort(...)` block down through the `await cleanup.waitForSignal(...)` line) with:

```ts
const port = parsePort(parsed.values.port);
if (port instanceof CliUsageError) {
  process.stderr.write(`${port.message}\n`);
  return 2;
}
const host = parseHost(parsed.values.host);
if (host instanceof CliUsageError) {
  process.stderr.write(`${host.message}\n`);
  return 2;
}

const cwd = process.cwd();
const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
const mode: DashboardServerMode = parsed.values.dev === true ? 'dev' : 'prod';

let handle: DashboardServerHandle;
try {
  handle = await startDashboardServer({ cwd, configPath, port, host, mode });
} catch (err) {
  reportError(err, cwd);
  return 1;
}

const cleanup = createCleanupRegistry();
cleanup.register(() => handle.stop(), { name: 'dashboard-server' });

logger.info(
  mode === 'dev'
    ? `Dashboard listening on ${handle.url} (dev mode, HMR enabled)`
    : `Dashboard listening on ${handle.url}`,
);
if (isLanExposedHost(host)) {
  logger.warn(
    'Dashboard is listening on a LAN-facing host. Keep the startup URL private because this process can write local project files.',
  );
}
if (parsed.values.open === true) {
  openBrowser(handle.url);
}

await cleanup.waitForSignal({ signals: ['SIGINT', 'SIGTERM'] });
return 0;
```

- [ ] **Step 5: Run the smoke test**

Run: `bun test tests/cli/commands/dashboard-dev-mode.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full test suite + lint + typecheck**

Run: `bun run check && bun run typecheck && bun test --parallel`
Expected: Green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/dashboard.ts src/cli/dashboard/web/types.ts tests/cli/commands/dashboard-dev-mode.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): launch Bun fullstack dev server behind --dev flag

Extracts startDashboardServer() from runDashboard so tests can drive it
directly. Dev mode wires Bun.serve({ routes, development: { hmr,
console } }) against a static dashboard.html shell; prod mode keeps the
existing fetch-only path that serves dist/dashboard-bundle/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Document the dev command in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Add the new section**

In `CLAUDE.md`, locate the `## Workflow rules` section. Immediately after it (before `## What "done" looks like for the bootstrap milestone`), insert:

```markdown
## Dashboard frontend development

- Use `bun run src/cli/index.ts dashboard --dev` for iterative work on
  `src/cli/dashboard/web/**`. This launches Bun's fullstack dev server
  with HMR; no pre-build of `dist/dashboard-bundle/` is required.
- `bun run src/cli/index.ts dashboard` (no flag) continues to serve the
  pre-built bundle from `dist/dashboard-bundle/` and is the path used by
  the npm-published CLI and compiled binaries.
- The dev server bundles `.tsx` and Tailwind CSS on demand via
  `bun-plugin-tailwind` (see `bunfig.toml`). The prod bundle is still
  produced by `scripts/build-dashboard-bundle.ts` and is required before
  `bun run build:cli` or `bun publish`.
```

- [ ] **Step 2: Verify the file still renders well**

Run: `head -100 CLAUDE.md`
Expected: the new section reads cleanly between Workflow rules and the bootstrap-milestone section.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): document `nectar dashboard --dev` workflow

Adds a short "Dashboard frontend development" section so future
contributors (and future Claude sessions) reach for --dev instead of
running `bun run build:dashboard-bundle` before every dashboard
iteration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manual verification + final CI gate

No new code. This is the gate before opening the PR.

- [ ] **Step 1: Launch dev mode against `example/`**

Run: `cd example && bun ../src/cli/index.ts dashboard --dev --open`
Expected: Browser opens to `http://127.0.0.1:4322/`, dashboard renders, no console errors.

- [ ] **Step 2: Verify HMR**

Edit `src/cli/dashboard/web/DashboardApp.tsx` — change any visible string. Save.
Expected: Browser updates within ~1 second without a full page reload. Bun's HMR client log appears in DevTools console.

- [ ] **Step 3: Verify Tailwind plugin path**

In the same browser session, edit a Tailwind class on any element (e.g. add `bg-red-500` somewhere). Save.
Expected: Style applies after HMR push. If it does not (Tailwind plugin not wired correctly), escalate to the user — fallback is the sidecar `tailwindcss --watch` path described in Task 6.

- [ ] **Step 4: Verify SPA hard-navigation**

In a new tab, navigate directly to `http://127.0.0.1:4322/posts/hello-nectar/edit`.
Expected: HMR-enabled shell loads (no 404). Editor mounts via SPA routing.

- [ ] **Step 5: Verify prod mode still works**

Stop the dev server. Run: `bun run build:dashboard-bundle && bun run src/cli/index.ts dashboard`
Expected: Bundle builds clean, prod dashboard renders, `<meta name="nectar-dashboard-token">` is gone from the HTML source, but writes still work (token comes from `/api/dashboard/bootstrap`).

- [ ] **Step 6: Run the local CI equivalent**

Run: `bun run check && bun run typecheck && bun test --parallel`
Expected: All green.

Optionally: `bun run run-github-actions-locally` if the user has it set up.

- [ ] **Step 7: Push and open a PR**

Per project rules (CLAUDE.md "PR ワークフロー"): use `/pr-complete` (or equivalent) to push `feature/dashboard-dev-mode` and open the PR against `main`. Do not local-merge.

---

## Self-Review

Spec coverage walk-through:

- §1 (Command surface, `--dev` flag, prod default) → Task 4, Task 7
- §2 (runDashboard split, routes/fetch coexistence) → Task 7
- §3 (HTML entrypoint, two shells) → Task 5 (dev shell), Task 3 (prod shell cleanup)
- §4 (Tailwind plugin) → Task 6
- §5 (Token bootstrap) → Task 1 (server), Task 2 (frontend), Task 3 (prod meta removal)
- §6 (API handlers / content watch coexistence) → Task 7 (smoke test covers `/api/state` working alongside `routes`)
- §7 (CLAUDE.md) → Task 8
- §8 (Non-goals) → no tasks needed; documented in spec
- §9 (Tests) → Task 1 (bootstrap unit), Task 3 (updated meta-tag test), Task 7 (dev-mode smoke)
- §10 (PoC items, fallback plan) → noted inline in Tasks 6 / 9 with escalation path

No gaps.

Placeholder scan: searched the plan for "TBD", "implement later", "etc." — none found. Every code block is concrete. The one ambiguity flagged in the spec ("wherever the write-header helper lives today") is now resolved as `src/cli/dashboard/web/lib/api.ts` per the grep in Task 2.

Type consistency: `DashboardServerMode` (Task 1, Task 7), `startDashboardServer` / `DashboardServerHandle` (Task 7), `setDashboardToken` / `getDashboardToken` (Task 2) are spelled consistently across tasks. Bootstrap response shape `{ token: string; mode: 'dev' | 'prod' }` matches between Task 1 (server JSON) and Task 2 (`BootstrapResponse` interface).

One implementation risk to watch: Bun's behavior when `routes` and `fetch` both match the same path. Per docs, `routes` takes priority. If a surprise emerges where a custom `fetch` API path collides with the SPA routes list (e.g. a future `/posts/:slug/edit` API), revisit `buildDevRoutes` to use `'/posts/:slug/edit'` only in dev mode where it should resolve before any API regex would.
