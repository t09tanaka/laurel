import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type RedirectRule, collapseRedirects, loadRedirects } from './redirects.ts';

const TEMPLATE_TOKEN = '__LAUREL_REDIRECTS_JSON__';

interface CloudFrontRedirectRule {
  statusCode: RedirectRule['status'];
  location: string;
}

type CloudFrontRedirectMap = Record<string, CloudFrontRedirectRule>;

export function formatCloudFrontRedirectMap(rules: readonly RedirectRule[]): string {
  const map: CloudFrontRedirectMap = {};
  for (const rule of collapseRedirects(rules)) {
    map[rule.from] = {
      statusCode: rule.status,
      location: rule.to,
    };
  }
  return JSON.stringify(map, null, 2).replace(/\//g, '\\/');
}

export function formatCloudFrontRedirectFunction(rules: readonly RedirectRule[]): string {
  return CLOUDFRONT_REDIRECTS_TEMPLATE.replace(TEMPLATE_TOKEN, formatCloudFrontRedirectMap(rules));
}

export async function generateCloudFrontRedirectFunction(opts: {
  cwd: string;
  outputPath: string;
}): Promise<void> {
  const rules = await loadRedirects(opts.cwd);
  await ensureDir(dirname(opts.outputPath));
  await writeFile(opts.outputPath, formatCloudFrontRedirectFunction(rules));
}

export const CLOUDFRONT_REDIRECTS_TEMPLATE = `// CloudFront Function (viewer-request) - redirects generated from redirects.yaml.
//
// Generate this file during deploy, then paste or publish it as a CloudFront
// Function associated with the viewer-request event. CloudFront Functions run
// before the S3 origin request, so redirects are returned at the edge without
// requiring an S3 website endpoint, Lambda@Edge, or any backend service.
//
// Exact URI matches only:
//   /old-post -> /new-post
//   /feed     -> /rss.xml
//
// Regenerate whenever redirects.yaml changes.

const REDIRECTS = __LAUREL_REDIRECTS_JSON__;

function handler(event) {
  const request = event.request;
  const rule = REDIRECTS[request.uri];

  if (!rule) {
    return request;
  }

  let location = rule.location;
  const querystring = serializeQuerystring(request.querystring || {});
  if (querystring.length > 0 && location.indexOf('?') === -1) {
    location = [location, querystring].join('?');
  }

  return {
    statusCode: rule.statusCode,
    statusDescription: statusDescription(rule.statusCode),
    headers: {
      location: { value: location },
      'cache-control': { value: 'max-age=300' },
    },
  };
}

function statusDescription(statusCode) {
  if (statusCode === 301) return 'Moved Permanently';
  if (statusCode === 302) return 'Found';
  if (statusCode === 307) return 'Temporary Redirect';
  if (statusCode === 308) return 'Permanent Redirect';
  return 'Found';
}

function serializeQuerystring(querystring) {
  const parts = [];

  for (const key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) {
      continue;
    }

    const param = querystring[key];
    if (param.multiValue) {
      for (let i = 0; i < param.multiValue.length; i++) {
        parts.push(
          [encodeURIComponent(key), encodeURIComponent(param.multiValue[i].value)].join('='),
        );
      }
    } else {
      parts.push([encodeURIComponent(key), encodeURIComponent(param.value)].join('='));
    }
  }

  return parts.join('&');
}
`;
