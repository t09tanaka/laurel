import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { bundleExportUrl, importBundle, markBundleNeedsReview } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type {
  ContentSummary,
  DashboardContentView,
  DashboardList,
  DashboardStatusCounts,
} from '../types.ts';
import type { ConfirmApi } from './ConfirmDialog.tsx';
import { StatePanel } from './StatePanel.tsx';
import type { ToastApi } from './Toast.tsx';

interface ContentTableProps {
  kind: DashboardContentView;
  list: DashboardList<ContentSummary>;
  resultCount: number;
  statusFilter: string;
  query: string;
  onStatusFilterChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (slug: string) => void;
  onRefresh: () => void;
  toast: ToastApi;
  confirm: ConfirmApi;
}

// `list.total` reflects items after status + search filtering. To tell
// "no files on disk" apart from "filter just hides everything", we use
// `statusCounts.all` (search-applied, status-unfiltered) and only treat
// it as a real count when no search is active.
function isTrulyEmpty(list: DashboardList<ContentSummary>, query: string): boolean {
  if (query.trim().length > 0) return false;
  const allCount = list.statusCounts?.all ?? list.total;
  return allCount === 0;
}

const STATUS_TABS: ReadonlyArray<{
  value: string;
  label: string;
  key: keyof DashboardStatusCounts;
}> = [
  { value: '', label: 'All', key: 'all' },
  { value: 'draft', label: 'Drafts', key: 'draft' },
  { value: 'published', label: 'Published', key: 'published' },
  { value: 'needs-review', label: 'Needs review', key: 'needsReview' },
];

export function ContentTable(props: ContentTableProps): JSX.Element {
  const { kind, list } = props;
  const isPages = kind === 'pages';
  const entryKind = kind === 'pages' ? 'page' : 'post';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleImport(file: File): Promise<void> {
    setImporting(true);
    try {
      // Dry-run with skip to probe for slug collision.
      const probe = await importBundle(file, { dryRun: true, onConflict: 'skip' });
      if (probe.skipped) {
        // Slug already exists — ask for confirmation before overwriting.
        const ok = await props.confirm.ask({
          title: 'Entry already exists',
          body: `A ${entryKind} with slug "${probe.slug}" already exists. Overwrite it and mark it for review?`,
          confirmLabel: 'Overwrite',
          cancelLabel: 'Cancel',
          intent: 'danger',
        });
        if (!ok) return;
        await importBundle(file, { dryRun: false, onConflict: 'overwrite' });
      } else {
        // No collision — proceed with skip policy (equivalent for new entries).
        await importBundle(file, { dryRun: false, onConflict: 'skip' });
      }
      props.onRefresh();
      props.toast.push({ intent: 'success', message: `Imported ${probe.slug}` });
    } catch (err) {
      props.toast.push({
        intent: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div>
      <div class="panelHead listHead">
        <div class="listHeadMeta">
          <h2 class="listHeadTitle">{kind}</h2>
          <span class="meta listHeadCount">
            {props.resultCount} result(s) · page {list.page} of {list.pages}
          </span>
        </div>
        <div class="listHeadActions">
          <StatusTabs
            value={props.statusFilter}
            counts={list.statusCounts}
            onChange={props.onStatusFilterChange}
          />
          <button
            type="button"
            class="btn secondary btnCompact"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'Importing…' : 'Import zip'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            class="srOnly"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = (event.target as HTMLInputElement).files?.[0];
              if (file) void handleImport(file);
            }}
          />
        </div>
      </div>
      {list.items.length ? (
        <div class="tableWrap">
          <table class="table contentTable">
            <colgroup>
              <col class="titleCol" />
              <col class="statusCol" />
              <col class="dateCol" />
              <col class="actionsCol" />
            </colgroup>
            <thead class="srOnly">
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th class="dateCol">Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <ContentRow
                  key={item.slug}
                  item={item}
                  kind={kind}
                  entryKind={entryKind}
                  isPages={isPages}
                  onOpen={() => props.onOpen(item.slug)}
                  onRefresh={props.onRefresh}
                  toast={props.toast}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : isTrulyEmpty(list, props.query) ? (
        <StatePanel
          kind="empty"
          title={`No ${kind} yet`}
          message={`Create your first one with the New button or by adding a Markdown file to content/${kind}/.`}
        />
      ) : (
        <StatePanel
          kind="empty"
          title={`No matching ${kind}`}
          message="Try a different status or clear the search."
        />
      )}
      {list.pages > 1 ? (
        <div class="pager" aria-label={`${kind} pagination`}>
          <button
            class="btn secondary"
            id="prev"
            type="button"
            disabled={list.page <= 1}
            onClick={props.onPrev}
          >
            Prev
          </button>
          <span class="pagerLabel">
            Page {list.page} of {list.pages}
          </span>
          <button
            class="btn secondary"
            id="next"
            type="button"
            disabled={list.page >= list.pages}
            onClick={props.onNext}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface StatusTabsProps {
  value: string;
  counts: DashboardStatusCounts | undefined;
  onChange: (value: string) => void;
}

function StatusTabs({ value, counts, onChange }: StatusTabsProps): JSX.Element {
  const activeIndex = Math.max(
    0,
    STATUS_TABS.findIndex((tab) => tab.value === value),
  );
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function focusTab(nextIndex: number, activate: boolean): void {
    const tab = STATUS_TABS[nextIndex];
    if (!tab) return;
    refs.current[nextIndex]?.focus();
    if (activate) onChange(tab.value);
  }
  function onKeyDown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        focusTab((index - 1 + STATUS_TABS.length) % STATUS_TABS.length, true);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusTab((index + 1) % STATUS_TABS.length, true);
        return;
      case 'Home':
        event.preventDefault();
        focusTab(0, true);
        return;
      case 'End':
        event.preventDefault();
        focusTab(STATUS_TABS.length - 1, true);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const tab = STATUS_TABS[index];
        if (tab) onChange(tab.value);
        return;
      }
      default:
        return;
    }
  }
  return (
    <div
      role="tablist"
      aria-label="Filter by status"
      aria-orientation="horizontal"
      class="statusTabs"
    >
      {STATUS_TABS.map((tab, index) => {
        const active = tab.value === value;
        const count = counts ? counts[tab.key] : undefined;
        const isFocusableTabStop = index === activeIndex;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={isFocusableTabStop ? 0 : -1}
            data-active={active ? 'true' : 'false'}
            class="statusTab"
            data-status={tab.value || 'all'}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span class="statusTabLabel">{tab.label}</span>
            <span class="statusTabCount">{count ?? '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ContentRowProps {
  item: ContentSummary;
  kind: DashboardContentView;
  entryKind: 'post' | 'page';
  isPages: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  toast: ToastApi;
}

function ContentRow({
  item,
  kind,
  entryKind,
  isPages,
  onOpen,
  onRefresh,
  toast,
}: ContentRowProps): JSX.Element {
  const status = item.status ?? 'published';
  const title = item.title?.trim() ? item.title : '(untitled)';
  const editorHref = pathForEditor(kind, item.slug);
  const [exporting, setExporting] = useState(false);
  // Clicking anywhere on the row that's not an existing anchor /
  // button opens the editor — the title link and Detail link still
  // behave as before, and the Preview link / Export action stop
  // here so they don't get swallowed. Modifier keys are left alone so
  // the user can still cmd-click a title to open in a new tab.
  const onRowClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement | null)?.closest('a, button')) return;
    event.preventDefault();
    onOpen();
  };

  async function handleExport(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    setExporting(true);
    try {
      await markBundleNeedsReview(entryKind, item.slug);
      window.location.href = bundleExportUrl(entryKind, item.slug);
      onRefresh();
      toast.push({ intent: 'success', message: `Exported ${item.slug}` });
    } catch (err) {
      toast.push({
        intent: 'error',
        title: 'Export failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: row click is a pointer-only affordance; keyboard users navigate through the inner title and Detail anchors which retain link semantics
    <tr class="contentRow" data-row-slug={item.slug} data-status={status} onClick={onRowClick}>
      <td class="titleCell">
        <div class="titleLine">
          <a
            class="titleLink"
            href={editorHref}
            title={title}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen();
            }}
          >
            <span class="titleText">{title}</span>
          </a>
          {isPages && item.approval?.status !== 'approved' ? (
            <ApprovalPill approval={item.approval} compact />
          ) : null}
        </div>
        <div class="slugLine">
          <span class="slug" dir="rtl" title={item.slug}>
            {item.slug}
          </span>
        </div>
      </td>
      <td class="statusCell">
        <span class="statusBadge" data-status={status}>
          {status}
        </span>
      </td>
      <td class="dateCell">{formatDate(item.createdAt)}</td>
      <td class="actionsCell">
        <div class="rowActions">
          {item.preview?.openUrl ? (
            <a class="textLink" href={item.preview.openUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
          ) : null}
          <a
            class="textLink textLinkStrong"
            href={editorHref}
            data-edit={item.slug}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpen();
            }}
          >
            Detail
          </a>
          <button
            type="button"
            class="textLink"
            disabled={exporting}
            onClick={(event) => void handleExport(event)}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </td>
    </tr>
  );
}

interface ApprovalPillProps {
  approval: ContentSummary['approval'];
  compact?: boolean;
}

function ApprovalPill({ approval, compact: _compact }: ApprovalPillProps): JSX.Element {
  const state = approval?.status ?? 'needs-approval';
  const label = state === 'approved' ? 'Approved' : state === 'stale' ? 'Stale' : 'Needs approval';
  // Minimal italic serif label; only rendered when state is not the
  // default approved path (the parent gates rendering).
  return (
    <span class="approvalLabel" data-approval={state}>
      {label}
    </span>
  );
}
