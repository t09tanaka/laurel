import type { JSX } from 'preact';
import { matches } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type { DashboardList, TaxonomySummary } from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

interface TaxonomyViewProps {
  kind: 'authors' | 'tags';
  list: DashboardList<TaxonomySummary>;
  query: string;
  onEdit: (slug: string) => void;
  onMaterialize: (slug: string) => void;
}

export function TaxonomyView(props: TaxonomyViewProps): JSX.Element {
  const q = props.query.toLowerCase();
  const items = props.list.items.filter((item) =>
    matches(`${item.name} ${item.slug} ${item.path ?? ''} ${item.url ?? ''}`, q),
  );
  return (
    <div>
      <div class="panelHead listHead">
        <div class="listHeadMeta">
          <h2 class="listHeadTitle srOnly">{props.kind}</h2>
          <span class="listHeadCount">
            <span class="listHeadNumeral">{props.list.total}</span>
            <span class="listHeadCountLabel">{props.list.total === 1 ? 'record' : 'records'}</span>
          </span>
        </div>
      </div>
      {items.length ? (
        <div class="tableWrap">
          <table class="table">
            <thead class="srOnly">
              <tr>
                <th>Name</th>
                <th>Posts ({props.kind === 'authors' ? 'authored' : 'tagged'})</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const editorHref = item.editable ? pathForEditor(props.kind, item.slug) : null;
                // Non-editable rows (generated stubs that still need a
                // materialised file) have no editor target, so we
                // leave them inert and let the explicit "Create file"
                // button handle that case.
                const onRowClick = item.editable
                  ? (event: MouseEvent) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      if ((event.target as HTMLElement | null)?.closest('a, button')) return;
                      event.preventDefault();
                      props.onEdit(item.slug);
                    }
                  : undefined;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: row click is a pointer-only affordance; keyboard users navigate through the inner title anchor and Edit button which retain their own semantics
                  <tr
                    key={item.slug}
                    class="contentRow"
                    data-source={item.source ?? 'file'}
                    data-editable={item.editable ? 'true' : 'false'}
                    onClick={onRowClick}
                  >
                    <td class="titleCell">
                      <div class="titleLine">
                        {editorHref ? (
                          <a
                            class="titleLink"
                            href={editorHref}
                            title={item.name}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                                return;
                              event.preventDefault();
                              props.onEdit(item.slug);
                            }}
                          >
                            <span class="titleText">{item.name}</span>
                          </a>
                        ) : (
                          <span class="titleText" title={item.name}>
                            {item.name}
                          </span>
                        )}
                      </div>
                      <div class="slugLine">
                        <span class="slug" dir="rtl" title={item.slug}>
                          {item.slug}
                        </span>
                      </div>
                      {item.description ? <div class="meta">{item.description}</div> : null}
                    </td>
                    <td
                      class="dateCell taxCountCell"
                      title={`${item.count} posts use this ${props.kind === 'authors' ? 'author' : 'tag'}`}
                    >
                      <span class="taxCountNum">{item.count}</span>
                      <span class="taxCountUnit"> {item.count === 1 ? 'post' : 'posts'}</span>
                    </td>
                    <td class="actionsCell">
                      <div class="rowActions">
                        {item.editable ? (
                          <a
                            class="textLink textLinkStrong"
                            href={editorHref ?? '#'}
                            data-edit={item.slug}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                                return;
                              event.preventDefault();
                              props.onEdit(item.slug);
                            }}
                          >
                            Detail
                          </a>
                        ) : (
                          <button
                            class="textLink textLinkStrong"
                            type="button"
                            data-materialize={item.slug}
                            onClick={() => props.onMaterialize(item.slug)}
                          >
                            Create file
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : props.list.total === 0 ? (
        <StatePanel
          kind="empty"
          title={`No ${props.kind} yet`}
          message={`Generated entries from posts appear here once you set ${props.kind === 'authors' ? 'an author:' : 'tags:'} in any post's frontmatter.`}
        />
      ) : (
        <StatePanel
          kind="empty"
          title={`No matching ${props.kind}`}
          message="Clear the search to see all records."
        />
      )}
    </div>
  );
}
