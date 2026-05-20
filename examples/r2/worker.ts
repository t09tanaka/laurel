export interface Env {
  SITE: R2Bucket;
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

const MANIFEST_KEY = '_routes-manifest.json';
const EMPTY_MANIFEST: RoutesManifest = {
  version: 1,
  redirects: [],
  headers: [],
};

export default {
  async fetch(request: Request, { SITE }: Env): Promise<Response> {
    const url = new URL(request.url);
    const manifest = await loadRoutesManifest(SITE);
    const redirect = findRedirect(manifest.redirects, url.pathname);
    if (redirect) {
      const destination = new URL(redirect.destination, request.url);
      return Response.redirect(destination.toString(), redirect.status);
    }

    const key = pathnameToR2Key(url.pathname);
    const object = await SITE.get(key);
    if (!object) return new Response('Not found', { status: 404 });

    const response = objectToResponse(object, request.method);
    return applyHeaderRules(response, manifest.headers, url.pathname);
  },
};

async function loadRoutesManifest(bucket: R2Bucket): Promise<RoutesManifest> {
  const object = await bucket.get(MANIFEST_KEY);
  if (!object) return EMPTY_MANIFEST;

  try {
    return (await new Response(object.body).json()) as RoutesManifest;
  } catch {
    return EMPTY_MANIFEST;
  }
}

function pathnameToR2Key(pathname: string): string {
  const key = pathname.replace(/^\/+/, '');
  if (key === '') return 'index.html';
  if (key.endsWith('/')) return `${key}index.html`;
  return key;
}

function objectToResponse(object: R2ObjectBody, method: string): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(method === 'HEAD' ? null : object.body, { headers });
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
