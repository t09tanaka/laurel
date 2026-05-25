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
        <span class="kicker" id="kicker">
          {copy.kicker}
        </span>
        <h1 class="viewTitle" id="viewTitle">
          {copy.title}
        </h1>
        {/* viewMeta description intentionally hidden visually — kept in DOM
         * for assistive technology (aria-describedby could reference it
         * later); the title + page context (sidebar + kicker) suffices
         * for sighted users. */}
        <p class="viewMeta srOnly" id="viewMeta">
          {copy.meta}
        </p>
      </div>
      {toolbar}
    </header>
  );
}
