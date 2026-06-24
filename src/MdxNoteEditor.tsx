import { useEffect, useMemo, useRef } from "react";
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
  const loadedNoteId = useRef<string | null>(null);

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

  useEffect(() => {
    if (loadedNoteId.current === noteId) return;
    editorRef.current?.setMarkdown(value);
    loadedNoteId.current = noteId;
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
        ref={editorRef}
        markdown={value}
        plugins={plugins}
        className="mdx-editor-root"
        contentEditableClassName="markdown read mdx-editor-content"
        placeholder="Start writing..."
        spellCheck
        toMarkdownOptions={{ bullet: "-", emphasis: "*" }}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize) return;
          onChange(markdown);
        }}
      />
    </div>
  );
}
