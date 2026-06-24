import { $isListItemNode, $isListNode } from "@lexical/list";
import { $getRoot, $getSelection, $isElementNode, $isRangeSelection, type LexicalEditor } from "lexical";

export function cleanupMarkdownAfterCut(markdown: string): string {
  return markdown
    .replace(/^\s*[-*+]\s*$(\n|$)/gm, "")
    .replace(/^\s*\d+\.\s*$(\n|$)/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();
}

function removeEmptyBlocks() {
  const root = $getRoot();
  for (const child of [...root.getChildren()]) {
    if ($isListNode(child)) {
      for (const item of [...child.getChildren()]) {
        if ($isListItemNode(item) && item.getTextContent().trim() === "") {
          item.remove();
        }
      }
      if (child.getChildrenSize() === 0) {
        child.remove();
      }
      continue;
    }
    if ($isElementNode(child) && child.getTextContent().trim() === "") {
      child.remove();
    }
  }
}

export function cutLexicalSelection(editor: LexicalEditor): boolean {
  let removed = false;
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
    selection.removeText();
    removeEmptyBlocks();
    removed = true;
  });
  return removed;
}
