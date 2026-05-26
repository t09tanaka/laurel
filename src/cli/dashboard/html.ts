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
