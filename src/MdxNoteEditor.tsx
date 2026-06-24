import { useLayoutEffect, useMemo, useRef } from "react";
import {
  MDXEditor,
  codeBlockPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  type MDXEditorMethods
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

export function MdxNoteEditor({
  noteId,
  value,
  onChange,
  onLinkClick
}: {
  noteId: string;
  value: string;
  onChange: (markdown: string) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href?: string) => void;
}) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const synced = useRef({ noteId: "", value: "" });
  const ignoreChange = useRef(true);

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      linkPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      codeBlockPlugin()
    ],
    []
  );

  useLayoutEffect(() => {
    ignoreChange.current = true;

    function syncEditor() {
      const editor = editorRef.current;
      if (!editor) return false;
      if (synced.current.noteId === noteId && synced.current.value === value) {
        return true;
      }
      editor.setMarkdown(value);
      synced.current = { noteId, value };
      return true;
    }

    if (!syncEditor()) {
      const frame = requestAnimationFrame(() => {
        syncEditor();
        ignoreChange.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }

    const frame = requestAnimationFrame(() => {
      ignoreChange.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [noteId, value]);

  return (
    <div
      className="mdx-note-editor"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (anchor instanceof HTMLAnchorElement) {
          onLinkClick(event as unknown as React.MouseEvent<HTMLAnchorElement>, anchor.getAttribute("href") ?? undefined);
        }
      }}
    >
      <MDXEditor
        key={noteId}
        ref={editorRef}
        markdown={value}
        plugins={plugins}
        className="mdx-editor-root"
        contentEditableClassName="markdown mdx-editor-content"
        placeholder="Start writing..."
        spellCheck
        toMarkdownOptions={{ bullet: "-", emphasis: "*" }}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize || ignoreChange.current) return;
          synced.current = { noteId, value: markdown };
          onChange(markdown);
        }}
      />
    </div>
  );
}
