import type { JSX } from 'preact';

interface SkeletonContentTableProps {
  /** How many fake rows to render. Matches the natural per-page count. */
  rows?: number;
}

/**
 * First-load placeholder for the posts/pages content table. Mirrors the real
 * .contentTable shape (title + slug + status pill + date + actions) so the
 * dashboard never flashes a blank panel — the chrome stays sharp and only
 * the table interior wears the skeleton.
 */
export function SkeletonContentTable({ rows = 4 }: SkeletonContentTableProps): JSX.Element {
  return (
    <div class="skeletonTableWrap" aria-hidden="true">
      <table class="table contentTable skeletonTable">
        <thead>
          <tr>
            <th>Title</th>
            <th class="dateCol">Updated</th>
            <th>
              <span class="srOnly">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i} class="skeletonRow">
              <td class="titleCell">
                <div class="titleLine">
                  <span class="skeletonBar skeletonBarTitle" />
                  <span class="skeletonBar skeletonBarPill" />
                </div>
                <div class="slugLine">
                  <span class="skeletonBar skeletonBarSlug" />
                </div>
              </td>
              <td class="dateCell">
                <span class="skeletonBar skeletonBarDate" />
              </td>
              <td class="actionsCell">
                <div class="rowActions">
                  <span class="skeletonBar skeletonBarBtn" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
