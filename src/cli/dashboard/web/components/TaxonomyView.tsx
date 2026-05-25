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
            <span class="listHeadCountLabel">
              {props.list.total === 1 ? 'record' : 'records'}
            </span>
          </span>
        </div>
      </div>
      {items.length ? (
        <div class="tableWrap">
          <table class="table">
            {/* Column headers visually hidden for consistency with Posts /
             * Pages — the row content speaks for itself. */}
            <thead class="srOnly">
              <tr>
                <th>Name</th>
                <th>Posts</th>
                <th>Path</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.slug}
                  class="contentRow"
                  data-source={item.source ?? 'file'}
                  data-orphaned={item.orphaned ? 'true' : undefined}
                >
                  <td class="titleCell">
                    <div class="titleLine">
                      <span class="titleText" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div class="slugLine">
                      <span class="slug" dir="rtl" title={item.slug}>
                        {item.slug}
                      </span>
                    </div>
                    {item.description ? <div class="meta">{item.description}</div> : null}
                  </td>
                  <td class="dateCell">{item.count}</td>
                  <td>
                    <div class="pathText" title={item.path ?? item.materializePath ?? 'generated from references'}>
                      {item.path ?? item.materializePath ?? 'generated from references'}
                    </div>
                  </td>
                  <td>
                    {item.editable ? (
                      <a
                        class="btn secondary"
                        href={pathForEditor(props.kind, item.slug)}
                        data-edit={item.slug}
                        onClick={(event) => {
                          event.preventDefault();
                          props.onEdit(item.slug);
                        }}
                      >
                        Edit
                      </a>
                    ) : (
                      <button
                        class="btn secondary"
                        type="button"
                        data-materialize={item.slug}
                        onClick={() => props.onMaterialize(item.slug)}
                      >
                        Create file
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StatePanel kind="empty" message="No taxonomy files match this view." />
      )}
    </div>
  );
}
