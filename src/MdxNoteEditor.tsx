import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
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
import type { LexicalEditor } from "lexical";
import "@mdxeditor/editor/style.css";
import { cleanupMarkdownAfterCut, cutLexicalSelection } from "./mdxSelectionCut";
import { createLexicalEditorCapturePlugin } from "./mdxLexicalCapturePlugin";

export type MdxNoteEditorCutResult = {
  selectedMarkdown: string;
  markdown: string;
};

export type MdxNoteEditorHandle = {
  cutSelectionAndGetMarkdown: () => MdxNoteEditorCutResult | null;
};

export const MdxNoteEditor = forwardRef<MdxNoteEditorHandle, {
  noteId: string;
  value: string;
  onChange: (markdown: string) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href?: string) => void;
  onSelectionContextMenu?: (payload: { x: number; y: number; text: string }) => void;
}>(function MdxNoteEditor({
  noteId,
  value,
  onChange,
  onLinkClick,
  onSelectionContextMenu
}, ref) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const synced = useRef({ noteId: "", value: "" });
  const ignoreChange = useRef(true);

  const lexicalCapturePlugin = useMemo(
    () => createLexicalEditorCapturePlugin(lexicalEditorRef)(),
    []
  );

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      linkPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      codeBlockPlugin(),
      lexicalCapturePlugin
    ],
    [lexicalCapturePlugin]
  );

  useImperativeHandle(ref, () => ({
    cutSelectionAndGetMarkdown: () => {
      const editor = editorRef.current;
      const lexicalEditor = lexicalEditorRef.current;
      if (!editor || !lexicalEditor) return null;

      const selectedMarkdown = editor.getSelectionMarkdown().trim();
      if (!selectedMarkdown) return null;
      if (!cutLexicalSelection(lexicalEditor)) return null;

      const markdown = cleanupMarkdownAfterCut(editor.getMarkdown());
      synced.current = { noteId, value: markdown };
      ignoreChange.current = false;
      return { selectedMarkdown, markdown };
    }
  }), [noteId]);

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
      onContextMenu={(event) => {
        if (!onSelectionContextMenu) return;
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text) return;
        event.preventDefault();
        event.stopPropagation();
        onSelectionContextMenu({ x: event.clientX, y: event.clientY, text });
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
});
