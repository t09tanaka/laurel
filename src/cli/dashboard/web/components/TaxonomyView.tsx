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
      <div class="panelHead">
        <h2>{props.kind}</h2>
        <span class="meta">{props.list.total} records</span>
      </div>
      {items.length ? (
        <div class="tableWrap">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Posts</th>
                <th>Source</th>
                <th>Path</th>
                <th>
                  <span class="srOnly">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.slug}>
                  <td class="titleCell">
                    <b>{item.name}</b>
                    <div class="slug">{item.slug}</div>
                    <div class="meta">{item.description ?? ''}</div>
                  </td>
                  <td>{item.count}</td>
                  <td>
                    <span
                      class={`pill ${
                        item.orphaned ? 'danger' : item.source === 'generated' ? 'info' : 'subtle'
                      }`}
                    >
                      {item.source ?? 'file'}
                      {item.orphaned ? ' · orphaned' : ''}
                    </span>
                  </td>
                  <td>
                    <div class="pathText">
                      {item.path ?? item.materializePath ?? 'generated from content references'}
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
