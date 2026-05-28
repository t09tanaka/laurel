import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { uploadImage } from '../lib/api.ts';

interface FaviconFieldProps {
  value: string;
  onChange: (next: string) => void;
  onStatus?: (message: string) => void;
}

// Compact favicon picker: a small actual-size preview plus a file-picker
// button. Favicons are tiny (16/32/48px), so a full dropzone would both
// dwarf the asset and upscale the preview into a blurry mess — a button +
// small preview matches the asset's real scale.
export function FaviconField(props: FaviconFieldProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    props.onStatus?.(`Uploading ${file.name || 'favicon'}…`);
    const result = await uploadImage(file);
    setBusy(false);
    if (!result.ok) {
      props.onStatus?.(`Upload failed — ${result.error}`);
      return;
    }
    props.onStatus?.('');
    props.onChange(result.path);
  }

  return (
    <div class="faviconField">
      <span class={`faviconPreview${props.value ? ' filled' : ''}`} aria-hidden="true">
        {props.value ? <img src={props.value} alt="" class="faviconPreviewImg" /> : null}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.ico"
        class="srOnly"
        disabled={busy}
        onChange={(event) => {
          const file = (event.currentTarget as HTMLInputElement).files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        class="btn secondary btnCompact"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : props.value ? 'Replace' : 'Choose file'}
      </button>
      {props.value ? (
        <button type="button" class="faviconRemove" onClick={() => props.onChange('')}>
          Remove
        </button>
      ) : null}
    </div>
  );
}
