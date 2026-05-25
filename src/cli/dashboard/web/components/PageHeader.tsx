import type { ComponentChildren, JSX } from 'preact';
import type { ViewHeadCopy } from '../lib/view-head.ts';

interface PageHeaderProps {
  copy: ViewHeadCopy;
  toolbar?: ComponentChildren;
}

export function PageHeader({ copy, toolbar }: PageHeaderProps): JSX.Element {
  return (
    <header class="viewHead" id="viewHead">
      <div class="viewHeadCopy">
        {/* kicker dropped per user feedback — the sidebar nav + page
         * title carry enough context, and the kicker often duplicated
         * the title (Settings · Settings). The text is kept in the DOM
         * as srOnly for screen reader breadcrumb context. */}
        <span class="kicker srOnly" id="kicker">
          {copy.kicker}
        </span>
        <h1 class="viewTitle" id="viewTitle">
          {copy.title}
        </h1>
        <p class="viewMeta srOnly" id="viewMeta">
          {copy.meta}
        </p>
      </div>
      {toolbar}
    </header>
  );
}
