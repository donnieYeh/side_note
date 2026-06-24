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
import { cleanupMarkdownAfterCut, cutLexicalSelection, splitMarkdownBySelection, type MarkdownArchiveCut } from "./mdxSelectionCut";
import { createLexicalEditorCapturePlugin } from "./mdxLexicalCapturePlugin";

export type MdxNoteEditorCutResult = MarkdownArchiveCut;

export type MdxNoteEditorHandle = {
  prepareArchiveSelection: (
    fallbackPlainText: string,
    selectedMarkdownHint?: string,
    sourceMarkdownHint?: string
  ) => MdxNoteEditorCutResult | null;
  setMarkdown: (markdown: string) => void;
};

export const MdxNoteEditor = forwardRef<MdxNoteEditorHandle, {
  noteId: string;
  value: string;
  onChange: (markdown: string) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href?: string) => void;
  onSelectionContextMenu?: (payload: { x: number; y: number; text: string; markdown: string }) => void;
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
    prepareArchiveSelection: (fallbackPlainText, selectedMarkdownHint = "", sourceMarkdownHint = "") => {
      const editor = editorRef.current;
      const lexicalEditor = lexicalEditorRef.current;
      if (!editor) return null;

      const editorMarkdown = editor.getMarkdown();
      const sourceCandidates = [...new Set([editorMarkdown, sourceMarkdownHint, value].filter(Boolean))];
      const selectedFromEditor = editor.getSelectionMarkdown().trim();
      const selectedCandidates = [...new Set([selectedFromEditor, selectedMarkdownHint, fallbackPlainText].filter(Boolean))];

      let split: MarkdownArchiveCut | null = null;
      for (const sourceMarkdown of sourceCandidates) {
        for (const selected of selectedCandidates) {
          split = splitMarkdownBySelection(sourceMarkdown, selected, fallbackPlainText);
          if (split) break;
        }
        if (split) break;
      }
      if (!split) return null;

      if (lexicalEditor && selectedFromEditor && cutLexicalSelection(lexicalEditor)) {
        const lexicalRemaining = cleanupMarkdownAfterCut(editor.getMarkdown());
        if (lexicalRemaining !== cleanupMarkdownAfterCut(editorMarkdown)) {
          synced.current = { noteId, value: lexicalRemaining };
          ignoreChange.current = false;
          return { selectedMarkdown: split.selectedMarkdown, remainingMarkdown: lexicalRemaining };
        }
        editor.setMarkdown(editorMarkdown);
        synced.current = { noteId, value: editorMarkdown };
      }

      synced.current = { noteId, value: split.remainingMarkdown };
      ignoreChange.current = true;
      requestAnimationFrame(() => {
        ignoreChange.current = false;
      });
      return split;
    },
    setMarkdown: (markdown: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setMarkdown(markdown);
      synced.current = { noteId, value: markdown };
      ignoreChange.current = true;
      requestAnimationFrame(() => {
        ignoreChange.current = false;
      });
    }
  }), [noteId, value]);

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
        const markdown = editorRef.current?.getSelectionMarkdown().trim() ?? text;
        onSelectionContextMenu({ x: event.clientX, y: event.clientY, text, markdown });
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
