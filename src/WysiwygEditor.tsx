import { useLayoutEffect, useRef } from "react";
import {
  focusListItemAfter,
  getActiveListItem,
  isAtEndOfListItem,
  restoreCursor,
  saveCursor
} from "./editorCursor";
import { domToMarkdown, markdownToEditableHtml } from "./markdownConvert";

export function WysiwygEditor({
  value,
  onChange,
  onLinkClick
}: {
  value: string;
  onChange: (markdown: string) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href?: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastValue = useRef<string | null>(null);
  const composing = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastInputType = useRef<string | null>(null);
  const pendingEnter = useRef(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value !== lastValue.current) {
      editor.innerHTML = markdownToEditableHtml(value);
      lastValue.current = value;
    }
  }, [value]);

  function syncFromDom() {
    const editor = editorRef.current;
    if (!editor || composing.current) return;

    const inputType = lastInputType.current;
    lastInputType.current = null;

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const activeLi = getActiveListItem(editor);
    const isListEnter =
      !!range &&
      !!activeLi &&
      (inputType === "insertParagraph" || inputType === "insertLineBreak") &&
      isAtEndOfListItem(range, activeLi);

    const markdown = domToMarkdown(editor);
    lastValue.current = markdown;
    onChange(markdown);

    if (isListEnter && focusListItemAfter(editor, activeLi!)) {
      return;
    }

    const html = markdownToEditableHtml(markdown);
    if (html !== editor.innerHTML) {
      const cursor = saveCursor(editor, inputType);
      editor.innerHTML = html;
      restoreCursor(editor, cursor);
    }
  }

  function scheduleSync() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      syncFromDom();
    });
  }

  return (
    <article
      ref={editorRef}
      className="markdown read wysiwyg-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Start writing..."
      onKeyDown={(event) => {
        if (event.key === "Enter") pendingEnter.current = true;
      }}
      onInput={(event) => {
        const native = event.nativeEvent as InputEvent;
        lastInputType.current = native.inputType || (pendingEnter.current ? "insertParagraph" : null);
        pendingEnter.current = false;
        scheduleSync();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        scheduleSync();
      }}
      onClick={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          queueMicrotask(scheduleSync);
          return;
        }
        const anchor = (event.target as HTMLElement).closest("a");
        if (anchor instanceof HTMLAnchorElement) {
          onLinkClick(event as unknown as React.MouseEvent<HTMLAnchorElement>, anchor.getAttribute("href") ?? undefined);
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
        scheduleSync();
      }}
    />
  );
}
