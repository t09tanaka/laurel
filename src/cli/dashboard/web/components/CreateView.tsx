import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { createItem } from '../lib/api.ts';
import type { DashboardEditorKind } from '../types.ts';

interface CreateViewProps {
  defaultKind: DashboardEditorKind;
  onCreated: (kind: DashboardEditorKind, slug: string) => void;
  onCancel: () => void;
}

export function CreateView(props: CreateViewProps): JSX.Element {
  // Kind comes from the URL (/posts/new, /pages/new, ...). The form
  // doesn't ask again — the page header already announces which kind
  // is being created.
  const kind = props.defaultKind;
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (!title.trim()) {
      setNotice('Title or name is required.');
      return;
    }
    setSubmitting(true);
    setNotice('Creating file...');
    try {
      const { status, data } = await createItem({ kind, title: title.trim() });
      if (status >= 400) {
        setNotice(data.error ?? 'Could not create file');
        return;
      }
      props.onCreated(data.kind, data.slug);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form class="createPage" id="createPage" onSubmit={handleSubmit}>
        <label class="field wide">
          <span>Title or name</span>
          <input
            id="createTitle"
            autoComplete="off"
            required
            value={title}
            onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <output id="createNotice" class="notice">
          {notice}
        </output>
        <div class="createActions">
          <button class="btn" id="createSubmit" type="submit" disabled={submitting}>
            Create and edit
          </button>
          <button class="btn secondary" id="cancelCreate" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
