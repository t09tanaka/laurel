import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { exportPageBundle } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type {
  ContentSummary,
  DashboardContentView,
  DashboardList,
  DashboardStatusCounts,
} from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

interface ContentTableProps {
  kind: DashboardContentView;
  list: DashboardList<ContentSummary>;
  resultCount: number;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (slug: string) => void;
}

const STATUS_TABS: ReadonlyArray<{
  value: string;
  label: string;
  key: keyof DashboardStatusCounts;
}> = [
  { value: '', label: 'All', key: 'all' },
  { value: 'draft', label: 'Drafts', key: 'draft' },
  { value: 'published', label: 'Published', key: 'published' },
];

export function ContentTable(props: ContentTableProps): JSX.Element {
  const { kind, list } = props;
  const isPages = kind === 'pages';
  return (
    <div>
      <div class="panelHead listHead">
        <div class="listHeadMeta">
          <h2 class="listHeadTitle">{kind}</h2>
          <span class="meta listHeadCount">
            {props.resultCount} result(s) · page {list.page} of {list.pages}
          </span>
        </div>
        <StatusTabs
          value={props.statusFilter}
          counts={list.statusCounts}
          onChange={props.onStatusFilterChange}
        />
      </div>
      {list.items.length ? (
        <div class="tableWrap">
          <table class="table contentTable">
            <thead class="srOnly">
              <tr>
                <th>Title</th>
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
                  isPages={isPages}
                  onOpen={() => props.onOpen(item.slug)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StatePanel
          kind="empty"
          message={
            list.total === 0
              ? `No ${kind} yet. Create your first one with the New button or by adding a Markdown file to content/${kind}/.`
              : `No ${kind} match this filter. Try a different status or clear the search.`
          }
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
  isPages: boolean;
  onOpen: () => void;
}

function ContentRow({ item, kind, isPages, onOpen }: ContentRowProps): JSX.Element {
  const preview = item.preview ?? null;
  const status = item.status ?? 'published';
  const warningCount = item.warnings?.length ?? 0;
  const title = item.title?.trim() ? item.title : '(untitled)';
  const editorHref = pathForEditor(kind, item.slug);
  return (
    <tr class="contentRow" data-row-slug={item.slug}>
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
          <StatusPill status={status} />
          {isPages ? <ApprovalPill approval={item.approval} compact /> : null}
          {warningCount > 0 ? <WarnDot count={warningCount} /> : null}
        </div>
        <div class="slugLine">
          <span class="slug" dir="rtl" title={item.slug}>
            {item.slug}
          </span>
        </div>
        <details
          class="rowDetails"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <summary>Details</summary>
          <div class="detailGrid">
            {isPages ? (
              <div>
                <span class="detailLabel">Approval</span>
                <ApprovalDetail item={item} />
              </div>
            ) : null}
            <div>
              <span class="detailLabel">Preview</span>
              <PreviewDetail item={item} />
            </div>
            <div>
              <span class="detailLabel">Path</span>
              <div class="pathText">{item.path}</div>
            </div>
          </div>
        </details>
      </td>
      <td class="dateCell">{formatDate(item.createdAt)}</td>
      <td class="actionsCell">
        <div class="rowActions">
          {preview?.openUrl ? (
            <a
              class="btn secondary btnCompact"
              href={preview.openUrl}
              target="_blank"
              rel="noreferrer"
            >
              Preview
            </a>
          ) : null}
          <a
            class="btn secondary btnCompact"
            href={pathForEditor(kind, item.slug)}
            data-edit={item.slug}
            onClick={(event) => {
              event.preventDefault();
              onOpen();
            }}
          >
            Edit
          </a>
          {isPages ? <ExportOverflow slug={item.slug} /> : null}
        </div>
      </td>
    </tr>
  );
}

interface StatusPillProps {
  status: string;
}

function StatusPill({ status }: StatusPillProps): JSX.Element {
  // Minimal: italic serif text label, no chip / no glyph. The row
  // itself carries cell-typography (italic + opacity for drafts) so
  // status is communicated by typography, not decoration.
  return (
    <span
      class={`statusLabel statusLabel--${status === 'draft' ? 'draft' : 'published'}`}
      data-status={status}
    >
      {status}
    </span>
  );
}

interface ApprovalPillProps {
  approval: ContentSummary['approval'];
  compact?: boolean;
}

function ApprovalPill({ approval, compact: _compact }: ApprovalPillProps): JSX.Element {
  const state = approval?.status ?? 'needs-approval';
  const label = state === 'approved' ? 'Approved' : state === 'stale' ? 'Stale' : 'Needs approval';
  // Minimal: italic serif text label, no chip / no glyph.
  return (
    <span class="approvalLabel" data-approval={state}>
      {label}
    </span>
  );
}

function ApprovalDetail({ item }: { item: ContentSummary }): JSX.Element {
  const approval = item.approval ?? { status: 'needs-approval' };
  const detail = approval.approvedAt
    ? formatDate(approval.approvedAt)
    : 'Saved changes stay out of builds until approved.';
  return (
    <>
      <ApprovalPill approval={approval} />
      <div class="meta">{detail}</div>
    </>
  );
}

function PreviewDetail({ item }: { item: ContentSummary }): JSX.Element {
  const preview = item.preview ?? null;
  const label = preview?.label ?? 'Markdown preview';
  const state = preview?.state === 'current' ? 'current' : 'stale';
  return (
    <>
      <span class="previewLabel" data-state={state}>
        {label}
      </span>
      <div class="meta">{preview?.sourcePath ?? preview?.detail ?? 'Saved Markdown preview'}</div>
      {preview?.openUrl ? (
        <a class="previewLink" href={preview.openUrl} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : null}
    </>
  );
}

function WarnDot({ count }: { count: number }): JSX.Element {
  // Minimal: italic serif "N warning(s)" text only. Color is the
  // warn ink (already a11y-ok contrast); no glyph, no dot.
  const label = `${count} warning${count === 1 ? '' : 's'}`;
  return (
    <span class="warnInline" title={label}>
      {label}
    </span>
  );
}

interface ExportOverflowProps {
  slug: string;
}

function ExportOverflow({ slug }: ExportOverflowProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent | TouchEvent) {
      if (!wrapRef.current) return;
      if (event.target instanceof Node && wrapRef.current.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div class="overflowMenu" ref={wrapRef}>
      <button
        type="button"
        class="btn secondary btnCompact btnIcon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div role="menu" class="overflowMenuList">
          <button
            type="button"
            role="menuitem"
            class="overflowMenuItem"
            data-export-page={slug}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              void downloadPageBundle(slug);
            }}
          >
            Export bundle
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function downloadPageBundle(slug: string): Promise<void> {
  try {
    const data = await exportPageBundle(slug);
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.page.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}
