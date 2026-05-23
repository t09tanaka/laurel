import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  type ChangeBus,
  createChangeBus,
  handleDashboardRequest,
} from '~/cli/commands/dashboard.ts';

export interface DashboardVisualViewport {
  name: 'desktop' | 'laptop' | 'mobile';
  width: number;
  height: number;
  mobile: boolean;
}

export interface DashboardVisualScenario {
  name:
    | 'posts'
    | 'pages'
    | 'authors'
    | 'tags'
    | 'settings'
    | 'create'
    | 'editor'
    | 'conflict'
    | 'empty';
  label: string;
}

export interface DashboardVisualPlanOptions {
  project: string;
  output: string;
}

export interface DashboardVisualPlan {
  project: string;
  output: string;
  viewports: DashboardVisualViewport[];
  scenarios: DashboardVisualScenario[];
  screenshots: string[];
  htmlSnapshots: string[];
  commands: string[];
}

interface DashboardVisualOptions extends DashboardVisualPlanOptions {
  dryRun: boolean;
  smokeOnly: boolean;
  screenshots: boolean;
}

export const dashboardVisualViewports: DashboardVisualViewport[] = [
  { name: 'desktop', width: 1440, height: 1100, mobile: false },
  { name: 'laptop', width: 1280, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

export const dashboardVisualScenarios: DashboardVisualScenario[] = [
  { name: 'posts', label: 'Posts list' },
  { name: 'pages', label: 'Pages list' },
  { name: 'authors', label: 'Authors list' },
  { name: 'tags', label: 'Tags list' },
  { name: 'settings', label: 'Settings cards' },
  { name: 'create', label: 'Create page' },
  { name: 'editor', label: 'Editor page' },
  { name: 'conflict', label: 'Fingerprint conflict notice' },
  { name: 'empty', label: 'Empty search state' },
];

export function createDashboardVisualPlan({
  project,
  output,
}: DashboardVisualPlanOptions): DashboardVisualPlan {
  const screenshots = [];
  const htmlSnapshots = [];
  for (const viewport of dashboardVisualViewports) {
    for (const scenario of dashboardVisualScenarios) {
      screenshots.push(join(output, `${viewport.name}-${scenario.name}.png`));
      htmlSnapshots.push(join(output, `${viewport.name}-${scenario.name}.html`));
    }
  }
  return {
    project,
    output,
    viewports: dashboardVisualViewports,
    scenarios: dashboardVisualScenarios,
    screenshots,
    htmlSnapshots,
    commands: [
      'bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project',
      'bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project --smoke-only',
      'NECTAR_CHROME_PATH=/path/to/chrome bun scripts/dashboard-visual-qa.ts --project tests/fixtures/dashboard-visual-project',
    ],
  };
}

export async function runDashboardVisualQa(options: DashboardVisualOptions): Promise<void> {
  const project = resolve(options.project);
  const output = resolve(options.output);
  const plan = createDashboardVisualPlan({ project, output });
  if (options.dryRun) {
    console.log(JSON.stringify(toRelativePlan(plan), null, 2));
    return;
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const workingProject = await copyProjectFixture(project, output);
  const dashboard = startDashboardServer(workingProject);
  const origin = `http://${dashboard.server.hostname}:${dashboard.server.port}`;
  try {
    const smoke = await smokeDashboard(origin);
    await writeFile(join(output, 'smoke.json'), JSON.stringify(smoke, null, 2), 'utf8');
    if (options.smokeOnly || !options.screenshots) {
      console.log(`Dashboard smoke passed: ${origin}`);
      return;
    }
    const chrome = await launchChrome();
    try {
      for (const viewport of dashboardVisualViewports) {
        for (const scenario of dashboardVisualScenarios) {
          await captureScenario({
            origin,
            output,
            project: workingProject,
            chrome,
            viewport,
            scenario,
          });
        }
      }
    } finally {
      await chrome.close();
    }
    await writeFile(
      join(output, 'plan.json'),
      JSON.stringify(toRelativePlan(plan), null, 2),
      'utf8',
    );
    console.log(`Dashboard visual QA artifacts: ${relative(process.cwd(), output)}`);
  } finally {
    dashboard.server.stop(true);
  }
}

function startDashboardServer(cwd: string): {
  server: ReturnType<typeof Bun.serve>;
  bus: ChangeBus;
} {
  const bus = createChangeBus({ debounceMs: 1 });
  const token = 'visual-qa-token';
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    idleTimeout: 255,
    async fetch(request) {
      return handleDashboardRequest(request, {
        cwd,
        changeBus: bus,
        security: {
          origin: new URL(request.url).origin,
          token,
          lanExposed: false,
        },
      });
    },
  });
  return { server, bus };
}

async function smokeDashboard(origin: string): Promise<Record<string, unknown>> {
  const html = await fetchText(`${origin}/`);
  if (!html.includes('Nectar Dashboard')) {
    throw new Error('Dashboard HTML smoke failed: missing Nectar Dashboard title.');
  }
  const state = (await fetchJson(`${origin}/api/state?per_page=12`)) as {
    site?: { title?: unknown };
    posts?: {
      total?: unknown;
      items?: Array<{ preview?: { openUrl?: unknown } }>;
    };
    pages?: { total?: unknown };
    settings?: { cards?: unknown[] };
  };
  if (!state.posts || !state.pages || !state.settings) {
    throw new Error('Dashboard API smoke failed: missing posts, pages, or settings.');
  }
  const previewUrl = state.posts.items?.[0]?.preview?.openUrl;
  if (typeof previewUrl !== 'string' || !previewUrl.startsWith('/preview/content?')) {
    throw new Error('Dashboard API smoke failed: missing Markdown preview URL for the first post.');
  }
  const previewHtml = await fetchText(`${origin}${previewUrl}`);
  if (!previewHtml.includes('<html') || !previewHtml.includes('Nectar')) {
    throw new Error('Dashboard preview smoke failed: active theme preview did not render HTML.');
  }
  return {
    origin,
    title: state.site?.title,
    posts: state.posts?.total,
    pages: state.pages?.total,
    settingsCards: state.settings?.cards?.length ?? 0,
  };
}

async function copyProjectFixture(project: string, output: string): Promise<string> {
  const workingProject = join(output, '.work', 'project');
  await mkdir(dirname(workingProject), { recursive: true });
  await cp(project, workingProject, { recursive: true, dereference: true });
  return workingProject;
}

async function captureScenario({
  origin,
  output,
  project,
  chrome,
  viewport,
  scenario,
}: {
  origin: string;
  output: string;
  project: string;
  chrome: ChromeSession;
  viewport: DashboardVisualViewport;
  scenario: DashboardVisualScenario;
}): Promise<void> {
  const page = await chrome.newPage();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await page.send('Page.navigate', { url: origin });
    await waitForDashboard(page);
    await prepareScenario(page, project, scenario);
    await waitForDashboard(page);
    const base = `${viewport.name}-${scenario.name}`;
    const html = await page.evaluateString('document.documentElement.outerHTML');
    await writeFile(join(output, `${base}.html`), html, 'utf8');
    const screenshot = (await page.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
    })) as { data: string };
    await writeFile(join(output, `${base}.png`), Buffer.from(screenshot.data, 'base64'));
  } finally {
    await page.close();
  }
}

async function prepareScenario(
  page: CdpPage,
  project: string,
  scenario: DashboardVisualScenario,
): Promise<void> {
  if (scenario.name === 'posts') return;
  if (
    scenario.name === 'pages' ||
    scenario.name === 'authors' ||
    scenario.name === 'tags' ||
    scenario.name === 'settings'
  ) {
    await page.evaluate(`setView(${JSON.stringify(scenario.name)})`);
    return;
  }
  if (scenario.name === 'editor') {
    await page.evaluate("openEditor('posts', state.posts.items[0].slug)");
    await page.waitFor("document.getElementById('editor').classList.contains('open')");
    return;
  }
  if (scenario.name === 'create') {
    await page.evaluate('renderCreatePage()');
    await page.waitFor("document.getElementById('createPage') !== null");
    return;
  }
  if (scenario.name === 'empty') {
    await page.evaluate(
      "(async()=>{ dispatch({type:'view/set',view:'posts'}); dispatch({type:'search/set',query:'__nectar_visual_qa_empty__'}); document.getElementById('search').value=ui.query; await load(); })()",
    );
    await page.waitFor("document.querySelector('.statePanel.empty') !== null");
    return;
  }
  if (scenario.name === 'conflict') {
    const changedPath = await page.evaluateString(
      "(async()=>{ await openEditor('posts', state.posts.items[0].slug); return current.path; })()",
    );
    const filePath = join(project, changedPath);
    const raw = await readFile(filePath, 'utf8');
    await writeFile(filePath, `${raw}\nExternal visual QA change ${randomUUID()}\n`, 'utf8');
    await page.evaluate(
      "document.getElementById('editBody').value='Dashboard draft from visual QA'; saveEditor()",
    );
    await page.waitFor("document.getElementById('notice').textContent.includes('changed on disk')");
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.text();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return response.json();
}

interface ChromeSession {
  newPage(): Promise<CdpPage>;
  close(): Promise<void>;
}

class CdpPage {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(
    private socket: WebSocket,
    private closeTarget: () => Promise<void>,
  ) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP command failed'));
      else pending.resolve(message.result ?? {});
    });
  }

  static async connect(
    webSocketDebuggerUrl: string,
    closeTarget: () => Promise<void>,
  ): Promise<CdpPage> {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', () => resolveOpen(), { once: true });
      socket.addEventListener(
        'error',
        () => rejectOpen(new Error('Could not connect to Chrome.')),
        {
          once: true,
        },
      );
    });
    return new CdpPage(socket, closeTarget);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      this.socket.send(message);
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { exceptionDetails?: unknown; result?: { value?: unknown } };
    if (result.exceptionDetails) {
      throw new Error(`Runtime evaluation failed: ${expression}`);
    }
    return result.result?.value;
  }

  async evaluateString(expression: string): Promise<string> {
    return String(await this.evaluate(expression));
  }

  async waitFor(expression: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  }

  async close(): Promise<void> {
    this.socket.close();
    await this.closeTarget().catch(() => undefined);
  }
}

async function waitForDashboard(page: CdpPage): Promise<void> {
  await page.waitFor(
    "document.readyState === 'complete' && typeof state !== 'undefined' && state && document.getElementById('contentPanel').getAttribute('aria-busy') === 'false'",
  );
}

async function launchChrome(): Promise<ChromeSession> {
  const chromePath = await findChromeExecutable();
  const port = await reservePort();
  const profile = resolve('.nectar', `dashboard-visual-chrome-${randomUUID()}`);
  await mkdir(profile, { recursive: true });
  const proc = Bun.spawn({
    cmd: [
      chromePath,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  await waitForChrome(versionUrl, proc);
  return {
    async newPage() {
      const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: 'PUT',
      });
      if (!response.ok) throw new Error(`Could not create Chrome target: ${response.status}`);
      const target = (await response.json()) as {
        id: string;
        webSocketDebuggerUrl: string;
      };
      return CdpPage.connect(target.webSocketDebuggerUrl, async () => {
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      });
    },
    async close() {
      proc.kill('SIGTERM');
      await proc.exited.catch(() => undefined);
      await rm(profile, { recursive: true, force: true });
    },
  };
}

async function waitForChrome(versionUrl: string, proc: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      (await fetch(versionUrl)
        .then((response) => response.ok)
        .catch(() => false)) === true
    ) {
      return;
    }
    if ((await Promise.race([proc.exited, sleep(25).then(() => null)])) !== null) {
      const stderrStream = proc.stderr;
      const stderr =
        stderrStream instanceof ReadableStream ? await new Response(stderrStream).text() : '';
      throw new Error(`Chrome exited before DevTools was ready.\n${stderr.trim()}`);
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for Chrome DevTools.');
}

async function findChromeExecutable(): Promise<string> {
  if (process.env.NECTAR_CHROME_PATH) return process.env.NECTAR_CHROME_PATH;
  const macCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const candidate of macCandidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  const proc = Bun.spawn({
    cmd: [
      'sh',
      '-lc',
      'command -v google-chrome || command -v chromium || command -v chromium-browser || command -v microsoft-edge || true',
    ],
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const path = stdout.trim().split('\n')[0];
  if (path) return path;
  throw new Error(
    'Chrome executable not found. Install Chrome/Chromium or set NECTAR_CHROME_PATH=/path/to/chrome. Use --smoke-only for HTML/API smoke without screenshots.',
  );
}

async function reservePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response('reserved') });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error('Could not reserve a Chrome debugging port.');
  return port;
}

function toRelativePlan(plan: DashboardVisualPlan): DashboardVisualPlan {
  const rel = (path: string) => relative(process.cwd(), path) || '.';
  return {
    ...plan,
    project: rel(plan.project),
    output: rel(plan.output),
    screenshots: plan.screenshots.map(rel),
    htmlSnapshots: plan.htmlSnapshots.map(rel),
  };
}

function parseArgs(args: string[]): DashboardVisualOptions {
  const options: DashboardVisualOptions = {
    project: 'tests/fixtures/dashboard-visual-project',
    output: '.nectar/dashboard-visual-qa',
    dryRun: false,
    smokeOnly: false,
    screenshots: true,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--project') options.project = args[++index] ?? options.project;
    else if (arg === '--out' || arg === '--output')
      options.output = args[++index] ?? options.output;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--smoke-only') options.smokeOnly = true;
    else if (arg === '--no-screenshots') options.screenshots = false;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/dashboard-visual-qa.ts [options]

Options:
  --project <path>      Dashboard project fixture (default: tests/fixtures/dashboard-visual-project)
  --out <path>          Artifact directory (default: .nectar/dashboard-visual-qa)
  --dry-run             Print planned screenshots and HTML snapshots without starting a server
  --smoke-only          Run dashboard HTML/API smoke without launching Chrome
  --no-screenshots      Alias for smoke-only artifact generation without browser captures
  -h, --help            Show this help
`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

if (import.meta.main) {
  runDashboardVisualQa(parseArgs(Bun.argv.slice(2))).catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
