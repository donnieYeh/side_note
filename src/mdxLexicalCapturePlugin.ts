import { realmPlugin, rootEditor$ } from "@mdxeditor/editor";
import type { LexicalEditor } from "lexical";

export function createLexicalEditorCapturePlugin(editorRef: { current: LexicalEditor | null }) {
  return realmPlugin({
    init(realm) {
      realm.sub(rootEditor$, (editor) => {
        editorRef.current = editor;
      });
    }
  });
}
