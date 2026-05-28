import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

type DragHandler = (event: JSX.TargetedDragEvent<HTMLElement>) => void;

interface FileDropHover {
  /** True while a file is being dragged over the zone — drive the visual cue. */
  isDragging: boolean;
  /** Spread onto the dropzone element to track the dragged-over state. */
  dragHoverProps: {
    onDragEnter: DragHandler;
    onDragOver: DragHandler;
    onDragLeave: DragHandler;
  };
  /** Call from the element's own onDrop to release the dragged-over state. */
  clearDrag: () => void;
}

function hasFiles(event: JSX.TargetedDragEvent<HTMLElement>): boolean {
  return event.dataTransfer?.types?.includes('Files') ?? false;
}

/**
 * Tracks whether a file is currently dragged over a dropzone so callers can
 * paint an explicit "release to drop" cue. Centralised because the dragleave
 * handling is subtle: dragging across a child element fires dragleave on the
 * parent, so we only release when the pointer actually exits the zone bounds
 * (relatedTarget no longer contained) to avoid flicker.
 */
export function useFileDropHover(): FileDropHover {
  const [isDragging, setIsDragging] = useState(false);

  return {
    isDragging,
    clearDrag: () => setIsDragging(false),
    dragHoverProps: {
      onDragEnter: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setIsDragging(true);
      },
      onDragOver: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        setIsDragging(true);
      },
      onDragLeave: (event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        setIsDragging(false);
      },
    },
  };
}
