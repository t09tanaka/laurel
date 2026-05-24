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
  const [kind, setKind] = useState<DashboardEditorKind>(props.defaultKind);
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
      <div class="panelHead">
        <h2>New file</h2>
        <span class="meta">writes one Markdown file</span>
      </div>
      <form class="createPage" id="createPage" onSubmit={handleSubmit}>
        <label class="field">
          <span>Kind</span>
          <select
            id="createKind"
            value={kind}
            onChange={(event) =>
              setKind((event.currentTarget as HTMLSelectElement).value as DashboardEditorKind)
            }
          >
            <option value="posts">Post</option>
            <option value="pages">Page</option>
            <option value="authors">Author</option>
            <option value="tags">Tag</option>
          </select>
        </label>
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
