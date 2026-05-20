// CloudFront Function (viewer-request) - redirects generated from redirects.yaml.
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
// Regenerate whenever redirects.yaml changes. This checked-in sample contains
// a small example map; the generator replaces REDIRECTS with your own rules.

const REDIRECTS = {
  '/old-post': {
    statusCode: 301,
    location: '/new-post/',
  },
  '/feed': {
    statusCode: 301,
    location: '/rss.xml',
  },
  '/preview': {
    statusCode: 302,
    location: '/new-preview/',
  },
};

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
