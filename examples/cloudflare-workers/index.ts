export interface Env {
  ASSETS: Fetcher;
}

interface HeaderEntry {
  key: string;
  value: string;
}

interface HeaderRule {
  source: string;
  headers: HeaderEntry[];
}

interface RedirectRule {
  source: string;
  destination: string;
  status: 301 | 302 | 307 | 308;
}

interface RoutesManifest {
  version: 1;
  redirects: RedirectRule[];
  headers: HeaderRule[];
}

const EMPTY_MANIFEST: RoutesManifest = {
  version: 1,
  redirects: [],
  headers: [],
};

let manifestPromise: Promise<RoutesManifest> | undefined;

export default {
  async fetch(request: Request, { ASSETS }: Env): Promise<Response> {
    const manifest = await loadRoutesManifest(ASSETS, request);
    const url = new URL(request.url);
    const redirect = findRedirect(manifest.redirects, url.pathname);
    if (redirect) {
      const destination = new URL(redirect.destination, request.url);
      return Response.redirect(destination.toString(), redirect.status);
    }

    const response = await ASSETS.fetch(request);
    return applyHeaderRules(response, manifest.headers, url.pathname);
  },
};

async function loadRoutesManifest(assets: Fetcher, request: Request): Promise<RoutesManifest> {
  manifestPromise ??= fetchRoutesManifest(assets, request);
  return manifestPromise;
}

async function fetchRoutesManifest(assets: Fetcher, request: Request): Promise<RoutesManifest> {
  const manifestUrl = new URL('/_routes-manifest.json', request.url);
  const response = await assets.fetch(manifestUrl.toString());
  if (!response.ok) return EMPTY_MANIFEST;
  return (await response.json()) as RoutesManifest;
}

function findRedirect(rules: RedirectRule[], pathname: string): RedirectRule | undefined {
  return rules.find((rule) => matchesRoutePattern(rule.source, pathname));
}

function applyHeaderRules(response: Response, rules: HeaderRule[], pathname: string): Response {
  const out = new Response(response.body, response);
  const applied = new Set<string>();
  for (const rule of rules) {
    if (!matchesRoutePattern(rule.source, pathname)) continue;
    for (const header of rule.headers) {
      const key = header.key.toLowerCase();
      if (applied.has(key)) continue;
      out.headers.set(header.key, header.value);
      applied.add(key);
    }
  }
  return out;
}

function matchesRoutePattern(pattern: string, pathname: string): boolean {
  if (pattern === pathname || pattern === '/*') return true;
  if (pattern.endsWith('*')) {
    return pathname.startsWith(pattern.slice(0, -1));
  }
  return false;
}
