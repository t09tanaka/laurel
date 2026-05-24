export function renderDashboardHtml(token = ''): string {
  return String.raw`<!doctype html>
<html lang="en" data-theme="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="nectar-dashboard-token" content="${escapeAttr(token)}">
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

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
