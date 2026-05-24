import type { JSX } from 'preact';
import { exportPageBundle } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type { ContentSummary, DashboardContentView, DashboardList } from '../types.ts';
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

export function ContentTable(props: ContentTableProps): JSX.Element {
  const { kind, list } = props;
  const isPages = kind === 'pages';
  return (
    <div>
      <div class="panelHead">
        <div>
          <h2>{kind}</h2>
          <span class="meta">
            {props.resultCount} result(s) · page {list.page} of {list.pages}
          </span>
        </div>
        <details class="listFilters">
          <summary>Filters</summary>
          <label class="field">
            <span>Status</span>
            <select
              id="statusFilter"
              value={props.statusFilter}
              onChange={(event) =>
                props.onStatusFilterChange((event.currentTarget as HTMLSelectElement).value)
              }
            >
              <option value="">Any status</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
            </select>
          </label>
        </details>
      </div>
      {list.items.length ? (
        <div class="tableWrap">
          <table class="table contentTable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
                <th>
                  <span class="srOnly">Actions</span>
                </th>
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
        <StatePanel kind="empty" />
      )}
      <div class="pager">
        <button
          class="btn secondary"
          id="prev"
          type="button"
          disabled={list.page <= 1}
          onClick={props.onPrev}
        >
          Prev
        </button>
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
  return (
    <tr>
      <td class="titleCell">
        <b>{item.title}</b>
        <div class="slug">{item.slug}</div>
        {item.warnings && item.warnings.length > 0 ? (
          <span class="warnBadge">
            {item.warnings.length} warning{item.warnings.length === 1 ? '' : 's'}
          </span>
        ) : null}
        <details class="rowDetails">
          <summary>Details</summary>
          <div class="detailGrid">
            {isPages ? (
              <div>
                <span class="detailLabel">Approval</span>
                <ApprovalCell item={item} />
              </div>
            ) : null}
            <div>
              <span class="detailLabel">Preview</span>
              <PreviewCell item={item} />
            </div>
            <div>
              <span class="detailLabel">Path</span>
              <div class="pathText">{item.path}</div>
            </div>
          </div>
        </details>
      </td>
      <td>
        <span class={`pill ${status === 'draft' ? 'draft' : ''}`}>{status}</span>
      </td>
      <td>{formatDate(item.createdAt)}</td>
      <td>
        <div class="rowActions">
          {preview?.openUrl ? (
            <a class="btn secondary" href={preview.openUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
          ) : null}
          <a
            class="btn secondary"
            href={pathForEditor(kind, item.slug)}
            data-edit={item.slug}
            onClick={(event) => {
              event.preventDefault();
              onOpen();
            }}
          >
            Edit
          </a>
          {isPages ? (
            <button
              class="btn secondary"
              type="button"
              data-export-page={item.slug}
              onClick={() => {
                void downloadPageBundle(item.slug);
              }}
            >
              Export
            </button>
          ) : null}
        </div>
      </td>
    </tr>
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

function ApprovalCell({ item }: { item: ContentSummary }): JSX.Element {
  const approval = item.approval ?? { status: 'needs-approval' };
  const label =
    approval.status === 'approved'
      ? 'Approved'
      : approval.status === 'stale'
        ? 'Stale approval'
        : 'Needs approval';
  const cls = approval.status === 'approved' ? '' : 'draft';
  const detail = approval.approvedAt
    ? formatDate(approval.approvedAt)
    : 'Saved changes stay out of builds until approved.';
  return (
    <>
      <span class={`pill ${cls}`}>{label}</span>
      <div class="meta">{detail}</div>
    </>
  );
}

function PreviewCell({ item }: { item: ContentSummary }): JSX.Element {
  const preview = item.preview ?? null;
  const label = preview?.label ?? 'Markdown preview';
  const cls = preview?.state === 'current' ? '' : 'draft';
  return (
    <>
      <span class={`pill ${cls}`}>{label}</span>
      <div class="meta">{preview?.sourcePath ?? preview?.detail ?? 'Saved Markdown preview'}</div>
      {preview?.openUrl ? (
        <a class="previewLink" href={preview.openUrl} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : null}
    </>
  );
}
