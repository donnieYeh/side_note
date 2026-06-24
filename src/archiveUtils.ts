import type { NoteWithMeta } from "./types";

export const ARCHIVE_TITLE_SUFFIX = " ::archive";

export function isArchiveCompanionTitle(title: string): boolean {
  return title.endsWith(ARCHIVE_TITLE_SUFFIX);
}

export function displayTitle(title: string): string {
  if (isArchiveCompanionTitle(title)) {
    return title.slice(0, -ARCHIVE_TITLE_SUFFIX.length);
  }
  return title;
}

export function archiveCompanionTitle(logicalTitle: string): string {
  const base = displayTitle(logicalTitle.trim() || "Untitled");
  return `${base}${ARCHIVE_TITLE_SUFFIX}`;
}

export function removeTextFromContent(content: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return content;

  let index = content.indexOf(text);
  let length = text.length;
  if (index === -1) {
    index = content.indexOf(trimmed);
    length = trimmed.length;
  }
  if (index === -1) return content;

  const result = `${content.slice(0, index)}${content.slice(index + length)}`;
  return result.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trimEnd();
}

export function appendArchivedText(existing: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return existing;
  if (!existing.trim()) return trimmed;
  return `${existing.trimEnd()}\n\n${trimmed}`;
}

export function filterVisibleNotes(notes: NoteWithMeta[], includeArchived: boolean): NoteWithMeta[] {
  return notes.filter((note) => {
    if (includeArchived) {
      if (isArchiveCompanionTitle(note.title)) {
        return !isEmptyArchiveContent(note.content_markdown);
      }
      if (isEmptyArchiveContent(note.content_markdown)) return false;
      return note.is_archived;
    }
    if (isArchiveCompanionTitle(note.title)) return false;
    return !note.is_archived;
  });
}

export function findArchiveCompanion(notes: NoteWithMeta[], mainNote: Pick<NoteWithMeta, "id" | "title">): NoteWithMeta | undefined {
  if (isArchiveCompanionTitle(mainNote.title)) return undefined;
  const logicalTitle = displayTitle(mainNote.title);
  const companionTitle = archiveCompanionTitle(logicalTitle);
  const matches = notes.filter(
    (note) =>
      note.title === companionTitle ||
      (note.is_archived && note.id !== mainNote.id && displayTitle(note.title) === logicalTitle && isEmptyArchiveContent(note.content_markdown))
  );
  if (!matches.length) return undefined;
  return matches.sort((left, right) => {
    if (isArchiveCompanionTitle(left.title) !== isArchiveCompanionTitle(right.title)) {
      return isArchiveCompanionTitle(left.title) ? -1 : 1;
    }
    const leftHasContent = !isEmptyArchiveContent(left.content_markdown);
    const rightHasContent = !isEmptyArchiveContent(right.content_markdown);
    if (leftHasContent !== rightHasContent) return leftHasContent ? -1 : 1;
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  })[0];
}

export function findDuplicateArchiveCompanions(notes: NoteWithMeta[], companion: NoteWithMeta): NoteWithMeta[] {
  return notes.filter((note) => note.title === companion.title && note.id !== companion.id);
}

export function normalizeArchiveContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/^\s*[-*+]\s+\[[ xX]?\]\s*$(\n|$)/gm, "")
    .replace(/^\s*[-*+]\s*$(\n|$)/gm, "")
    .replace(/^\s*\d+\.\s*$(\n|$)/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function isEmptyArchiveContent(content: string): boolean {
  return !normalizeArchiveContent(content);
}

export function isOrphanEmptyArchiveNote(notes: NoteWithMeta[], note: NoteWithMeta): boolean {
  if (!note.is_archived || !isEmptyArchiveContent(note.content_markdown)) return false;
  if (isArchiveCompanionTitle(note.title)) return true;
  const logicalTitle = displayTitle(note.title);
  const hasActiveMain = notes.some(
    (item) => item.id !== note.id && !item.is_archived && !isArchiveCompanionTitle(item.title) && displayTitle(item.title) === logicalTitle
  );
  return hasActiveMain;
}

export function shouldPurgeArchiveNote(notes: NoteWithMeta[], note: NoteWithMeta): boolean {
  return isOrphanEmptyArchiveNote(notes, note);
}

export function findMainNoteForCompanion(notes: NoteWithMeta[], companion: NoteWithMeta): NoteWithMeta | undefined {
  if (!isArchiveCompanionTitle(companion.title)) return undefined;
  const logicalTitle = displayTitle(companion.title);
  return notes.find(
    (note) => !isArchiveCompanionTitle(note.title) && displayTitle(note.title) === logicalTitle
  );
}
