import { invoke } from "@tauri-apps/api/core";
import type { EdgeSide, NoteWithMeta, Reminder, Tag } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;

const demoNote: NoteWithMeta = {
  id: "demo",
  title: "Side Note",
  content_markdown:
    "# 今日便签\n\n- [ ] 把窗口拖到左右边缘试试贴边收起\n- [ ] 给事项设置提醒\n\n链接示例：[OpenAI](https://openai.com)\n\n普通点击复制链接，Ctrl + 点击打开。",
  color: "#d8b86a",
  is_archived: false,
  is_pinned: true,
  is_read_only: false,
  reading_page: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: [{ id: "tag-demo", name: "Inbox", color: "#5f7d6a" }],
  reminders: []
};

let localNotes: NoteWithMeta[] = [demoNote];
let localTags: Tag[] = demoNote.tags;

async function call<T>(command: string, args?: Record<string, unknown>, fallback?: () => T): Promise<T> {
  if (isTauri) return invoke<T>(command, args);
  if (fallback) return fallback();
  throw new Error(`Command ${command} is only available in the desktop app.`);
}

export const api = {
  listNotes: (query = "", tagId: string | null = null, includeArchived = false) =>
    call<NoteWithMeta[]>("list_notes", { query, tagId, includeArchived }, () => {
      const q = query.trim().toLowerCase();
      return localNotes.filter((note) => {
        const matchesQuery =
          !q ||
          note.title.toLowerCase().includes(q) ||
          note.content_markdown.toLowerCase().includes(q);
        const matchesTag = !tagId || note.tags.some((tag) => tag.id === tagId);
        return matchesQuery && matchesTag && (includeArchived || !note.is_archived);
      });
    }),

  listTags: () => call<Tag[]>("list_tags", undefined, () => localTags),

  saveNote: (note: Partial<NoteWithMeta> & Pick<NoteWithMeta, "title" | "content_markdown" | "color">) =>
    call<NoteWithMeta>("save_note", { note }, () => {
      const now = new Date().toISOString();
      const existing = localNotes.find((item) => item.id === note.id);
      if (existing) {
        Object.assign(existing, { ...note, updated_at: now });
        return existing;
      }
      const created: NoteWithMeta = {
        id: crypto.randomUUID(),
        title: note.title,
        content_markdown: note.content_markdown,
        color: note.color,
        is_archived: note.is_archived ?? false,
        is_pinned: false,
        is_read_only: note.is_read_only ?? false,
        reading_page: note.reading_page ?? 0,
        created_at: now,
        updated_at: now,
        tags: [],
        reminders: []
      };
      localNotes.unshift(created);
      return created;
    }),

  deleteNote: (id: string) =>
    call<void>("delete_note", { id }, () => {
      localNotes = localNotes.filter((note) => note.id !== id);
    }),

  archiveNote: (id: string, archived: boolean) =>
    call<void>("archive_note", { id, archived }, () => {
      const note = localNotes.find((item) => item.id === id);
      if (note) note.is_archived = archived;
    }),

  updateReadingPage: (noteId: string, readingPage: number) =>
    call<void>("update_reading_page", { noteId, readingPage }, () => {
      const note = localNotes.find((item) => item.id === noteId);
      if (note) note.reading_page = Math.max(0, readingPage);
    }),

  upsertTag: (name: string, color: string) =>
    call<Tag>("upsert_tag", { name, color }, () => {
      const existing = localTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const tag = { id: crypto.randomUUID(), name, color };
      localTags.push(tag);
      return tag;
    }),

  setNoteTags: (noteId: string, tagIds: string[]) =>
    call<void>("set_note_tags", { noteId, tagIds }, () => {
      const note = localNotes.find((item) => item.id === noteId);
      if (note) note.tags = localTags.filter((tag) => tagIds.includes(tag.id));
    }),

  scheduleReminder: (noteId: string, taskAnchor: string | null, remindAt: string) =>
    call<Reminder>("schedule_reminder", { noteId, taskAnchor, remindAt }),

  dismissReminder: (id: string) => call<void>("dismiss_reminder", { id }),

  dueReminders: () => call<Reminder[]>("due_reminders", undefined, () => []),

  revealReminder: (noteId: string, reminderId: string) =>
    call<void>("reveal_reminder", { noteId, reminderId }, () => undefined),

  dockWindow: (side: EdgeSide) => call<void>("dock_window", { side }),

  dockIfNearEdge: () => call<boolean>("dock_if_near_edge"),

  dockNearest: () => call<void>("dock_nearest_window"),

  isDockCollapsed: () => call<boolean>("is_dock_collapsed", undefined, () => false),

  undockWindow: () => call<void>("undock_window"),

  setDockFastMode: (enabled: boolean) => call<void>("set_dock_fast_mode", { enabled }, () => undefined),

  toggleFullscreen: () => call<boolean>("toggle_fullscreen"),

  setAlwaysOnTop: (enabled: boolean) => call<void>("set_always_on_top", { enabled }),

  copyText: (text: string) =>
    call<void>("copy_text", { text }, () => navigator.clipboard.writeText(text) as unknown as void),

  openExternal: (url: string) =>
    call<void>("open_external", { url }, () => {
      window.open(url, "_blank");
    })
};
