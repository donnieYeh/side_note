type PathCursor = {
  kind: "path";
  path: number[];
  offset: number;
  visibleOffset: number;
};

type ListCursor = {
  kind: "list-item-start";
  listPath: number[];
  itemIndex: number;
};

export type CursorState = PathCursor | ListCursor;

function visibleOffsetBefore(root: HTMLElement, endContainer: Node, endOffset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(endContainer, endOffset);
  return range.toString().length;
}

function nodePath(root: HTMLElement, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function nodeFromPath(root: HTMLElement, path: number[]): Node | null {
  let current: Node = root;
  for (const index of path) {
    if (index >= current.childNodes.length) return null;
    current = current.childNodes[index];
  }
  return current;
}

export function isAtEndOfListItem(range: Range, li: HTMLLIElement): boolean {
  const probe = range.cloneRange();
  probe.selectNodeContents(li);
  probe.setStart(range.endContainer, range.endOffset);
  return probe.toString().length === 0;
}

function focusNodeStart(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, 0);
  } else if (node instanceof HTMLElement) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (firstText) {
      range.setStart(firstText, 0);
    } else {
      const text = document.createTextNode("");
      node.appendChild(text);
      range.setStart(text, 0);
    }
  } else {
    return;
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function restoreVisibleOffset(root: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let remaining = offset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function saveCursor(root: HTMLElement, inputType: string | null): CursorState | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;

  const anchorElement =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : (range.endContainer as HTMLElement);
  const li = anchorElement?.closest("li");
  const wantsNextItem = inputType === "insertParagraph" || inputType === "insertLineBreak";

  if (li instanceof HTMLLIElement && wantsNextItem && isAtEndOfListItem(range, li)) {
    const list = li.parentElement;
    if (list instanceof HTMLElement) {
      const listPath = nodePath(root, list);
      if (listPath) {
        const itemIndex = Array.from(list.children).indexOf(li) + 1;
        return { kind: "list-item-start", listPath, itemIndex };
      }
    }
  }

  const path = nodePath(root, range.endContainer);
  if (!path) return null;
  return {
    kind: "path",
    path,
    offset: range.endOffset,
    visibleOffset: visibleOffsetBefore(root, range.endContainer, range.endOffset)
  };
}

export function restoreCursor(root: HTMLElement, cursor: CursorState | null) {
  if (!cursor) return;

  if (cursor.kind === "list-item-start") {
    const list = nodeFromPath(root, cursor.listPath);
    if (!(list instanceof HTMLElement)) {
      return;
    }
    const items = Array.from(list.children).filter((el): el is HTMLLIElement => el.tagName === "LI");
    const target = items[cursor.itemIndex] ?? items[items.length - 1];
    if (target) focusNodeStart(target);
    return;
  }

  const selection = window.getSelection();
  if (!selection) return;

  const node = nodeFromPath(root, cursor.path);
  if (node) {
    const range = document.createRange();
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      range.setStart(node, Math.min(cursor.offset, length));
    } else if (node instanceof HTMLElement) {
      const length = node.childNodes.length;
      range.setStart(node, Math.min(cursor.offset, length));
    } else {
      restoreVisibleOffset(root, cursor.visibleOffset);
      return;
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  restoreVisibleOffset(root, cursor.visibleOffset);
}

export function focusListItemAfter(root: HTMLElement, li: HTMLLIElement) {
  const nextLi = li.nextElementSibling;
  if (nextLi instanceof HTMLLIElement) {
    focusNodeStart(nextLi);
    return true;
  }
  return false;
}

export function getActiveListItem(root: HTMLElement): HTMLLIElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const anchorElement =
    range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endContainer.parentElement
      : (range.endContainer as HTMLElement);
  const li = anchorElement?.closest("li");
  return li instanceof HTMLLIElement ? li : null;
}

export { focusNodeStart };
