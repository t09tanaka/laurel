import { useLayoutEffect } from 'preact/hooks';

/**
 * Toggle the `editorOpen` body class for the lifetime of a detail editor.
 *
 * The class is what collapses the dashboard sidebar and hands the full
 * viewport to the editor (see `body.editorOpen .side { display: none }` and
 * `body.editorOpen .shell` in styles.css). Every detail editor — posts/pages,
 * components, authors/tags — must set it so their layouts match; without it
 * the sidebar stays visible and the editor renders inside the shell grid.
 *
 * useLayoutEffect (not useEffect) so the class lands before paint, otherwise
 * the editor briefly renders inside the sidebar before collapsing.
 */
export function useEditorOpenBodyClass(): void {
  useLayoutEffect(() => {
    document.body.classList.add('editorOpen');
    return () => {
      document.body.classList.remove('editorOpen');
    };
  }, []);
}
