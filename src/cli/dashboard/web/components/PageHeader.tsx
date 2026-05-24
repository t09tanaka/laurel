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
        <p class="viewMeta" id="viewMeta">
          {copy.meta}
        </p>
      </div>
      {toolbar}
    </header>
  );
}
