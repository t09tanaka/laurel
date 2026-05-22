import { renderDashboardScript } from './script.ts';
import { DASHBOARD_STYLES } from './styles.ts';

export function renderDashboardHtml(token = ''): string {
  return String.raw`<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nectar Dashboard</title>
<style>
${DASHBOARD_STYLES}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside class="side" aria-label="Dashboard navigation"><div><div class="brand">Nectar</div><div class="tagline">file-backed editorial dashboard</div></div><nav class="nav" aria-label="Primary"><button data-icon="P" data-view="posts" class="active" aria-current="page"><span>Posts</span></button><button data-icon="G" data-view="pages"><span>Pages</span></button><button data-icon="A" data-view="authors"><span>Authors</span></button><button data-icon="T" data-view="tags"><span>Tags</span></button><button data-icon="S" data-view="settings"><span>Settings</span></button></nav><div class="sync" id="sync" role="status" aria-live="polite">syncing from disk</div></aside>
  <main class="main" id="main" tabindex="-1"><div class="top"><div><div class="kicker" id="kicker">Local workspace</div><h1 class="title" id="siteTitle">Nectar Dashboard</h1><div class="sub" id="siteSub">Reading content files directly from this repository.</div></div><div class="toolbar" aria-label="Dashboard tools"><label class="srOnly" for="search">Filter current view</label><input class="search" id="search" placeholder="Filter current view"><button class="btn secondary" id="refresh">Refresh</button><button class="btn" id="newItem">New</button></div></div><section class="stats" aria-label="Content totals"><div class="stat"><b id="postCount">0</b><span>posts</span></div><div class="stat"><b id="pageCount">0</b><span>pages</span></div><div class="stat"><b id="authorCount">0</b><span>authors</span></div><div class="stat"><b id="tagCount">0</b><span>tags</span></div></section><section class="panel" id="contentPanel" aria-live="polite" aria-busy="true"></section><section class="editor editorPage" id="editor" aria-labelledby="editorTitle"><div class="editorTop"><div><h2 id="editorTitle">Editor</h2><div class="meta" id="editorMeta">Saved file preview uses disk state.</div></div><div class="editorActions"><button class="btn secondary" id="previewEditor">Preview</button><button class="btn secondary" id="closeEditor">Close</button></div></div><div class="editorScroll"><div class="fields"><label class="field"><span>Title</span><input id="editTitle"></label><label class="field"><span>Status</span><select id="editStatus"><option>published</option><option>draft</option><option>scheduled</option></select></label></div><textarea id="editBody" aria-label="Markdown body"></textarea><div class="warningList" id="editorWarnings" role="status" aria-live="polite"></div><details class="advancedPanel" id="mediaPanel"><summary>Media</summary><div class="mediaGrid" aria-label="Media fields"><label class="field"><span>Feature image path</span><input id="editFeatureImage" placeholder="/content/images/cover.jpg"></label><label class="field"><span>Feature image alt</span><input id="editFeatureImageAlt"></label><label class="field wide"><span>Feature image caption</span><input id="editFeatureImageCaption"></label></div></details><details class="advancedPanel" id="formatPanel"><summary>Markdown tools</summary><div class="snippetBar" aria-label="Markdown snippets"><button class="btn secondary" data-snippet="bold" title="Bold">B</button><button class="btn secondary" data-snippet="link" title="Link">Link</button><button class="btn secondary" data-snippet="code" title="Inline code">Code</button><button class="btn secondary" data-snippet="heading" title="Heading">H2</button><button class="btn secondary" data-snippet="list" title="List">List</button><button class="btn secondary" data-snippet="image" title="Image">Image</button><button class="btn secondary" data-snippet="callout" title="Callout">Callout</button><button class="btn secondary" id="insertMedia">Insert media</button></div></details><details class="advancedPanel" id="previewPanel"><summary>Preview status</summary><div class="previewBox" id="artifactPreview"></div></details><details class="advancedPanel" id="recoveryPanel"><summary>Recovery</summary><div class="editorActions"><button class="btn secondary" id="restoreDraft" disabled>Restore draft</button><button class="btn secondary" id="rollbackEditor" disabled>Rollback</button></div><div class="storageNotice" id="draftNotice" role="status" aria-live="polite"></div><div class="editorHistory" id="editorHistory" role="status" aria-live="polite"></div></details></div><div class="editorFooter"><div class="notice" id="notice" role="status" aria-live="polite"></div><div class="editorActions"><button class="btn secondary" id="approvePage" disabled>Approve saved page</button><button class="btn" id="saveEditor">Save to file</button></div></div></section></main>
</div>
<script>
${renderDashboardScript(token)}
</script>
</body>
</html>`;
}
