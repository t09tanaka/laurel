import type { JSX } from 'preact';
import { useFileDropHover } from '../lib/use-file-drop-hover.ts';

interface UploadDropzoneProps {
  accept: string;
  file: File | null;
  disabled: boolean;
  hint: string;
  onPick: (file: File) => void;
  // Optional reset hook for the × button on the filled card. When omitted
  // the remove affordance is hidden; clicking the card still re-opens the
  // file picker so the operator can replace.
  onClear?: () => void;
  match: (name: string) => boolean;
}

export function UploadDropzone(props: UploadDropzoneProps): JSX.Element {
  const filled = props.file !== null;
  const { isDragging, dragHoverProps, clearDrag } = useFileDropHover();
  return (
    <label
      class={`themeUploadDrop${props.disabled ? ' busy' : ''}${filled ? ' filled' : ''}${
        isDragging ? ' isDragging' : ''
      }`}
      {...dragHoverProps}
      onDrop={(event) => {
        clearDrag();
        const candidate = Array.from(event.dataTransfer?.files ?? []).find((f) =>
          props.match(f.name),
        );
        if (!candidate) return;
        event.preventDefault();
        props.onPick(candidate);
      }}
    >
      <input
        type="file"
        accept={props.accept}
        class="srOnly"
        disabled={props.disabled}
        onChange={(event) => {
          const input = event.currentTarget as HTMLInputElement;
          const picked = input.files?.[0];
          if (picked) props.onPick(picked);
          // Reset so picking the same file twice in a row still fires.
          input.value = '';
        }}
      />
      {filled && props.file ? (
        <div class="themeUploadCard">
          <span class="themeUploadCardGlyph" aria-hidden="true" />
          <div class="themeUploadCardBody">
            <span class="themeUploadCardName">{props.file.name}</span>
            <span class="themeUploadCardMeta">
              {formatBytes(props.file.size)} · click to replace
            </span>
          </div>
          {props.onClear ? (
            <button
              type="button"
              class="themeUploadCardClear"
              aria-label="Remove file"
              disabled={props.disabled}
              onClick={(event) => {
                // Stop the click from bubbling to the wrapping <label>,
                // which would otherwise re-open the file picker the
                // instant the user tries to clear.
                event.preventDefault();
                event.stopPropagation();
                props.onClear?.();
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : (
        <span class="themeUploadHint">{props.hint}</span>
      )}
    </label>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
