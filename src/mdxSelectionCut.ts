import { $isListItemNode, $isListNode } from "@lexical/list";
import { $getRoot, $getSelection, $isElementNode, $isRangeSelection, type LexicalEditor } from "lexical";
import { removeTextFromContent } from "./archiveUtils";

export type MarkdownArchiveCut = {
  selectedMarkdown: string;
  remainingMarkdown: string;
};

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

export function splitMarkdownBySelection(
  sourceMarkdown: string,
  selectedMarkdown: string,
  fallbackPlainText = ""
): MarkdownArchiveCut | null {
  const candidates = [...new Set([selectedMarkdown.trim(), fallbackPlainText.trim()].filter(Boolean))];
  if (!candidates.length) return null;

  const normalizedSource = cleanupMarkdownAfterCut(sourceMarkdown);
  for (const selected of candidates) {
    const remainingMarkdown = cleanupMarkdownAfterCut(removeTextFromContent(sourceMarkdown, selected));
    if (remainingMarkdown !== normalizedSource) {
      return { selectedMarkdown: selected, remainingMarkdown };
    }

    const lineRemoved = removeMatchingLine(sourceMarkdown, selected);
    if (lineRemoved !== null && lineRemoved !== normalizedSource) {
      return { selectedMarkdown: selected, remainingMarkdown: lineRemoved };
    }
  }
  return null;
}

function removeMatchingLine(content: string, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.trim() === trimmed || line.includes(trimmed));
  if (index === -1) return null;

  lines.splice(index, 1);
  return cleanupMarkdownAfterCut(lines.join("\n"));
}
