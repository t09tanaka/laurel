import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { uploadImage } from '../lib/api.ts';
import { useFileDropHover } from '../lib/use-file-drop-hover.ts';

interface FeatureImageFieldProps {
  label?: string;
  value: string;
  alt?: string;
  showAlt?: boolean;
  onChange: (next: { value: string; alt?: string }) => void;
  onStatus?: (message: string) => void;
}

// Shared paper-textured dropzone used by the post Feature image panel
// and the taxonomy editor Cover / Feature image fields. Click-to-pick,
// drag-and-drop, hover/replace, and an inline Remove control.
export function FeatureImageField(props: FeatureImageFieldProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const { isDragging, dragHoverProps, clearDrag } = useFileDropHover();

  async function handleFile(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    props.onStatus?.(`Uploading ${file.name || 'image'}…`);
    const result = await uploadImage(file);
    setBusy(false);
    if (!result.ok) {
      props.onStatus?.(`Upload failed — ${result.error}`);
      return;
    }
    props.onStatus?.('');
    const altFromName = (file.name || 'image').replace(/\.[^.]+$/, '');
    props.onChange({
      value: result.path,
      alt: props.alt && props.alt.length > 0 ? props.alt : altFromName,
    });
  }

  return (
    <div class="featureImageField">
      {props.label ? <div class="featureImageFieldLabel">{props.label}</div> : null}
      <label
        class={`featureImageZone${props.value ? ' filled' : ''}${busy ? ' busy' : ''}${
          isDragging ? ' isDragging' : ''
        }`}
        aria-label="Image — click or drop to upload"
        {...dragHoverProps}
        onDrop={(event) => {
          clearDrag();
          const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
            f.type.startsWith('image/'),
          );
          if (!file) return;
          event.preventDefault();
          void handleFile(file);
        }}
      >
        <input
          type="file"
          accept="image/*"
          class="srOnly"
          disabled={busy}
          onChange={(event) => {
            const file = (event.currentTarget as HTMLInputElement).files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {props.value ? (
          <>
            <img src={props.value} alt={props.alt || ''} class="featureImagePreview" />
            <span class="featureImageHint">Click or drop to replace</span>
            <button
              type="button"
              class="featureImageRemove"
              onClick={(event) => {
                event.preventDefault();
                props.onChange({ value: '', alt: '' });
              }}
              title="Remove image"
            >
              Remove
            </button>
          </>
        ) : (
          <span class="featureImageEmpty">
            <em>{busy ? 'Uploading…' : 'Click or drop'}</em>
          </span>
        )}
      </label>
      {props.showAlt && props.value ? (
        <input
          class="featureImageAltInput"
          type="text"
          placeholder="Alt text for screen readers"
          value={props.alt ?? ''}
          onInput={(event) =>
            props.onChange({
              value: props.value,
              alt: (event.currentTarget as HTMLInputElement).value,
            })
          }
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </div>
  );
}
