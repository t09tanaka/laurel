import { readdir } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

type AxeNode = {
  target?: string[];
  failureSummary?: string;
};

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes?: AxeNode[];
};

type AxeResult = {
  url: string;
  violations?: AxeViolation[];
};

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);
const repoRoot = resolve(import.meta.dir, '..');
const distRoot = resolve(repoRoot, 'example/dist');
const EXCLUDED_ROUTES = new Set(['/feed/']);

async function collectHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return collectHtmlFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

function routePathForFile(file: string): string {
  const rel = relative(distRoot, file).split(sep);
  if (rel.length === 1 && rel[0] === 'index.html') {
    return '/';
  }
  if (basename(file) === 'index.html') {
    rel.pop();
    return `/${rel.map(encodeURIComponent).join('/')}/`;
  }
  return `/${rel.map(encodeURIComponent).join('/')}`;
}

async function serveDist(): Promise<ReturnType<typeof Bun.serve>> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Bad request', { status: 400 });
      }

      const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const candidate = resolve(distRoot, `.${requested}`);
      const distPrefix = distRoot.endsWith(sep) ? distRoot : `${distRoot}${sep}`;
      if (candidate !== distRoot && !candidate.startsWith(distPrefix)) {
        return new Response('Not found', { status: 404 });
      }

      const file = Bun.file(candidate);
      if (!(await file.exists())) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(file);
    },
  });
}

async function runAxe(urls: string[]): Promise<AxeResult[]> {
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      'x',
      'axe',
      ...urls,
      '--stdout',
      '--chrome-options=--headless=new --no-sandbox --disable-dev-shm-usage',
    ],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`axe failed with exit code ${code}\n${stderr.trim()}`);
  }

  try {
    return JSON.parse(stdout) as AxeResult[];
  } catch (error) {
    throw new Error(`axe did not emit valid JSON: ${(error as Error).message}\n${stdout}`);
  }
}

function formatBlockingViolations(results: AxeResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    const violations = result.violations ?? [];
    for (const violation of violations) {
      if (!violation.impact || !BLOCKING_IMPACTS.has(violation.impact)) {
        continue;
      }
      const targets = violation.nodes?.flatMap((node) => node.target ?? []).slice(0, 3) ?? [];
      lines.push(
        [
          `${result.url}: ${violation.id} (${violation.impact})`,
          `  ${violation.help}`,
          `  ${violation.helpUrl}`,
          targets.length > 0 ? `  targets: ${targets.join(', ')}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const files = await collectHtmlFiles(distRoot).catch((error) => {
    throw new Error(
      `example/dist is not ready for a11y checks. Run "bun run build:example" first.\n${(error as Error).message}`,
    );
  });
  if (files.length === 0) {
    throw new Error('example/dist contains no HTML files. Run "bun run build:example" first.');
  }

  const server = await serveDist();
  try {
    const origin = `http://${server.hostname}:${server.port}`;
    const urls = files
      .map((file) => routePathForFile(file))
      .filter((route) => !EXCLUDED_ROUTES.has(route))
      .map((route) => `${origin}${route}`);
    const results = await runAxe(urls);
    const blocking = formatBlockingViolations(results);
    if (blocking.length > 0) {
      console.error(`axe a11y gate failed: ${blocking.length} serious/critical violation(s).`);
      console.error(blocking.join('\n\n'));
      process.exit(1);
    }
    console.log(`axe a11y gate passed: ${urls.length} page(s), no serious/critical violations.`);
  } finally {
    server.stop(true);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
