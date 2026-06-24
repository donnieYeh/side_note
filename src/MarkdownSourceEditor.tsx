import { useLayoutEffect, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vscodeEditorSetup } from "./codemirrorSetup";

const sourceTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      background: "transparent"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: 'ui-monospace, "Cascadia Code", "Segoe UI Mono", monospace',
      fontSize: "13px",
      lineHeight: "1.56"
    },
    ".cm-content": {
      padding: "18px 8px 18px 0",
      caretColor: "#25231e"
    },
    ".cm-gutters": {
      background: "transparent",
      border: "none",
      color: "color-mix(in srgb, #25231e 42%, transparent)"
    },
    ".cm-activeLineGutter": {
      background: "transparent"
    },
    ".cm-activeLine": {
      background: "color-mix(in srgb, var(--note-accent) 8%, transparent)"
    }
  },
  { dark: false }
);

export function MarkdownSourceEditor({
  noteId,
  value,
  onChange
}: {
  noteId: string;
  value: string;
  onChange: (markdown: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const synced = useRef({ noteId: "", value: "" });
  const ignoreChange = useRef(true);

  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    ignoreChange.current = true;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          vscodeEditorSetup,
          markdown(),
          EditorView.lineWrapping,
          sourceTheme,
          EditorView.clickAddsSelectionRange.of((event) => event.altKey),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || ignoreChange.current) return;
            const doc = update.state.doc.toString();
            synced.current = { noteId, value: doc };
            onChangeRef.current(doc);
          })
        ]
      })
    });

    viewRef.current = view;
    synced.current = { noteId, value };

    const frame = requestAnimationFrame(() => {
      ignoreChange.current = false;
    });

    return () => {
      cancelAnimationFrame(frame);
      view.destroy();
      viewRef.current = null;
    };
  }, [noteId]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (synced.current.noteId === noteId && synced.current.value === value) return;

    ignoreChange.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
    synced.current = { noteId, value };

    const frame = requestAnimationFrame(() => {
      ignoreChange.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [noteId, value]);

  return (
    <div className="source-editor">
      <div ref={hostRef} className="source-editor-host" />
    </div>
  );
}
