import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Eye,
  Maximize2,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2
} from "lucide-react";
import { api } from "./api";
import type { EdgeSide, NoteWithMeta, Reminder, Tag } from "./types";
import { WysiwygEditor } from "./WysiwygEditor";

const palette = ["#d8b86a", "#6d8c7c", "#b76e79", "#7386b6", "#9b745c", "#6f7f92"];
const reminderPresets = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "Tonight", minutes: 60 * 6 }
];

type ReminderParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function emptyNote(): NoteWithMeta {
  const now = new Date().toISOString();
  return {
    id: "",
    title: "Untitled",
    content_markdown: "- [ ] ",
    color: palette[0],
    is_archived: false,
    is_pinned: false,
    is_read_only: false,
    reading_page: 0,
    created_at: now,
    updated_at: now,
    tags: [],
    reminders: []
  };
}

const NOVEL_FONT_SIZE_KEY = "side-note:novel-font-size";
const NOVEL_FONT_MIN = 12;
const NOVEL_FONT_MAX = 28;
const NOVEL_FONT_DEFAULT = 17;
const NOVEL_LINE_HEIGHT = 1.72;
const WHEEL_TURN_THRESHOLD = 120;
const WHEEL_TURN_COOLDOWN_MS = 400;

function loadNovelFontSize() {
  const stored = localStorage.getItem(NOVEL_FONT_SIZE_KEY);
  const parsed = stored ? Number(stored) : NOVEL_FONT_DEFAULT;
  if (!Number.isFinite(parsed)) return NOVEL_FONT_DEFAULT;
  return Math.min(NOVEL_FONT_MAX, Math.max(NOVEL_FONT_MIN, Math.round(parsed)));
}

function renderNovelPageContent(root: HTMLElement, pageText: string) {
  root.replaceChildren();
  for (const line of pageText.split("\n")) {
    const p = document.createElement("p");
    p.textContent = line || "\u00a0";
    root.appendChild(p);
  }
}

function novelPageFits(root: HTMLElement, maxHeight: number, pageText: string) {
  renderNovelPageContent(root, pageText);
  return root.scrollHeight <= maxHeight + 1;
}

function splitOverflowingNovelBlock(root: HTMLElement, maxHeight: number, block: string) {
  const chunks: string[] = [];
  let rest = block;
  while (rest.length > 0) {
    if (novelPageFits(root, maxHeight, rest)) {
      chunks.push(rest);
      break;
    }
    let lo = 1;
    let hi = rest.length;
    let best = 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (novelPageFits(root, maxHeight, rest.slice(0, mid))) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    let cut = best;
    const windowStart = Math.max(1, best - 24);
    const slice = rest.slice(windowStart, best);
    const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    if (lastBreak >= 0) cut = windowStart + lastBreak + 1;
    cut = Math.max(1, Math.min(cut, rest.length));
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return chunks;
}

function paginateNovelByLayout(measureEl: HTMLElement, maxHeight: number, text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [""];

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const pages: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) {
      pages.push(buffer.trim());
      buffer = "";
    }
  };

  for (const block of blocks) {
    const candidate = buffer ? `${buffer}\n\n${block}` : block;
    if (novelPageFits(measureEl, maxHeight, candidate)) {
      buffer = candidate;
      continue;
    }
    flush();
    if (novelPageFits(measureEl, maxHeight, block)) {
      buffer = block;
      continue;
    }
    const pieces = splitOverflowingNovelBlock(measureEl, maxHeight, block);
    if (pieces.length === 1) {
      buffer = pieces[0];
    } else {
      pages.push(...pieces.slice(0, -1));
      buffer = pieces[pieces.length - 1];
    }
  }
  flush();
  return pages.length ? pages : [normalized];
}

function syncNovelMeasureEl(pageEl: HTMLDivElement, measureEl: HTMLDivElement, fontSize: number) {
  measureEl.className = pageEl.className;
  measureEl.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "overflow:hidden"
  ].join(";");
  measureEl.style.width = `${pageEl.clientWidth}px`;
  measureEl.style.height = `${pageEl.clientHeight}px`;
  measureEl.style.fontSize = `${fontSize}px`;
  measureEl.style.lineHeight = String(NOVEL_LINE_HEIGHT);
  const computed = getComputedStyle(pageEl);
  measureEl.style.padding = computed.padding;
  measureEl.style.boxSizing = computed.boxSizing;
}

function splitNovelPages(text: string, pageSize = 1500) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [""];
  const pages: string[] = [];
  let buffer = "";
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;
    if (buffer.length && buffer.length + block.length + 2 > pageSize) {
      pages.push(buffer.trim());
      buffer = "";
    }
    if (block.length > pageSize) {
      if (buffer.trim()) {
        pages.push(buffer.trim());
        buffer = "";
      }
      for (let index = 0; index < block.length; index += pageSize) {
        pages.push(block.slice(index, index + pageSize));
      }
    } else {
      buffer += `${buffer ? "\n\n" : ""}${block}`;
    }
  }
  if (buffer.trim()) pages.push(buffer.trim());
  return pages.length ? pages : [normalized];
}

function reminderPartsFromDate(date: Date): ReminderParts {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    second: pad(date.getSeconds())
  };
}

function dateFromReminderParts(parts: ReminderParts) {
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

export function App() {
  const [notes, setNotes] = useState<NoteWithMeta[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draft, setDraft] = useState<NoteWithMeta>(emptyNote());
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [status, setStatus] = useState("Ready");
  const [highlightReminder, setHighlightReminder] = useState<string | null>(null);
  const [isDocked, setIsDocked] = useState(true);
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState<ReminderParts>(() => reminderPartsFromDate(new Date(Date.now() + 15 * 60_000)));
  const [noteMenu, setNoteMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);
  const [pendingImportNoteId, setPendingImportNoteId] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeNote = useMemo(() => notes.find((note) => note.id === activeId), [activeId, notes]);

  const refresh = useCallback(async () => {
    const [nextNotes, nextTags] = await Promise.all([
      api.listNotes(query, activeTag, includeArchived),
      api.listTags()
    ]);
    setNotes(nextNotes);
    setTags(nextTags);
    if (!activeId && nextNotes[0]) setActiveId(nextNotes[0].id);
    if (!nextNotes.length && !activeId) setDraft(emptyNote());
  }, [activeId, activeTag, includeArchived, query]);

  useEffect(() => {
    refresh().catch((error) => setStatus(error.message));
  }, [refresh]);

  useEffect(() => {
    if (activeNote) setDraft(activeNote);
  }, [activeNote]);

  useEffect(() => {
    api.setDockFastMode(draft.is_read_only).catch(() => undefined);
  }, [draft.is_read_only]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const due = await api.dueReminders();
      if (due[0]) {
        setActiveId(due[0].note_id);
        setHighlightReminder(due[0].id);
        await api.revealReminder(due[0].note_id, due[0].id);
        setStatus("Reminder due");
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const closeMenu = () => setNoteMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNoteMenu(null);
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function updateDraft(patch: Partial<NoteWithMeta>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(next), 500);
  }

  async function persist(note: NoteWithMeta) {
    if (!note.title.trim() && !note.content_markdown.trim()) return;
    const saved = await api.saveNote({
      id: note.id || undefined,
      title: note.title.trim() || "Untitled",
      content_markdown: note.content_markdown,
      color: note.color,
      is_pinned: note.is_pinned,
      is_read_only: note.is_read_only,
      reading_page: note.reading_page
    });
    setStatus("Saved");
    if (!activeId || activeId !== saved.id) setActiveId(saved.id);
    await refresh();
  }

  async function createNote() {
    const saved = await api.saveNote(emptyNote());
    setActiveId(saved.id);
    setDraft(saved);
    await refresh();
  }

  async function dock(side: EdgeSide) {
    await api.dockWindow(side);
    setIsDocked(true);
  }

  async function finishDrag(event: React.PointerEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    const moved = Math.abs(event.screenX - start.x) + Math.abs(event.screenY - start.y);
    if (moved < 8) return;
    const docked = await api.dockIfNearEdge();
    if (docked) setIsDocked(true);
  }

  async function setReminder(minutes: number) {
    const note = draft.id ? draft : await api.saveNote(draft);
    const remindAt = new Date(Date.now() + minutes * 60_000).toISOString();
    await api.scheduleReminder(note.id, null, remindAt);
    setStatus(`Reminder set for ${new Date(remindAt).toLocaleTimeString()}`);
    setReminderMenuOpen(false);
    await refresh();
  }

  async function setReminderAtTime() {
    const date = dateFromReminderParts(reminderAt);
    if (Number.isNaN(date.getTime())) {
      setStatus("Invalid reminder time");
      return;
    }
    if (date.getTime() <= Date.now()) {
      setStatus("Pick a future time");
      return;
    }
    const note = draft.id ? draft : await api.saveNote(draft);
    await api.scheduleReminder(note.id, null, date.toISOString());
    setStatus(`Reminder set for ${date.toLocaleString()}`);
    setReminderMenuOpen(false);
    await refresh();
  }

  function updateReminderPart(part: keyof ReminderParts, value: string) {
    const maxLength = part === "year" ? 4 : 2;
    const digits = value.replace(/\D/g, "").slice(0, maxLength);
    setReminderAt((current) => ({ ...current, [part]: digits }));
  }

  async function toggleTag(tag: Tag) {
    const note = draft.id ? draft : await api.saveNote(draft);
    const hasTag = draft.tags.some((item) => item.id === tag.id);
    const tagIds = hasTag ? draft.tags.filter((item) => item.id !== tag.id).map((item) => item.id) : [...draft.tags.map((item) => item.id), tag.id];
    await api.setNoteTags(note.id, tagIds);
    await refresh();
  }

  async function addTag() {
    const name = window.prompt("Tag name");
    if (!name?.trim()) return;
    const tag = await api.upsertTag(name.trim(), palette[tags.length % palette.length]);
    await toggleTag(tag);
  }

  async function handleArchive() {
    if (!draft.id) return;
    await api.archiveNote(draft.id, !draft.is_archived);
    setStatus(draft.is_archived ? "Restored" : "Archived");
    setActiveId(null);
    await refresh();
  }

  async function handleDelete() {
    if (!draft.id) return;
    await api.deleteNote(draft.id);
    setActiveId(null);
    await refresh();
  }

  async function archiveNoteById(id: string) {
    await api.archiveNote(id, true);
    setNoteMenu(null);
    if (activeId === id) setActiveId(null);
    await refresh();
  }

  async function deleteNoteById(id: string) {
    await api.deleteNote(id);
    setNoteMenu(null);
    if (activeId === id) setActiveId(null);
    await refresh();
  }

  function startImportText(noteId: string) {
    setPendingImportNoteId(noteId);
    setNoteMenu(null);
    importInputRef.current?.click();
  }

  async function importTextFile(file: File) {
    if (!pendingImportNoteId) return;
    const note = notes.find((item) => item.id === pendingImportNoteId) ?? draft;
    const text = await file.text();
    const title = file.name.replace(/\.[^.]+$/, "") || note.title || "Imported Text";
    const saved = await api.saveNote({
      id: pendingImportNoteId,
      title,
      content_markdown: text,
      color: note.color,
      is_archived: false,
      is_pinned: note.is_pinned,
      is_read_only: true,
      reading_page: 0
    });
    setPendingImportNoteId(null);
    setActiveId(saved.id);
    setDraft(saved);
    setStatus("Text imported");
    await refresh();
  }

  const setReadingPage = useCallback(async (page: number) => {
    if (!draft.id) return;
    const nextPage = Math.max(0, page);
    setDraft((current) => ({ ...current, reading_page: nextPage }));
    await api.updateReadingPage(draft.id, nextPage);
  }, [draft.id]);

  async function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href?: string) {
    event.preventDefault();
    if (!href) return;
    if (event.ctrlKey || event.metaKey) {
      await api.openExternal(href);
      setStatus("Opened link");
    } else {
      await api.copyText(href);
      setStatus("Copied link");
    }
  }

  const dueClass = (reminder: Reminder) => reminder.id === highlightReminder ? " reminder-hot" : "";

  return (
    <main
      className="shell"
      style={{ ["--note-accent" as string]: draft.color }}
      onContextMenu={(event) => {
        if (!(event.target as HTMLElement).closest(".note-card")) event.preventDefault();
      }}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".txt,text/plain"
        className="hidden-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) importTextFile(file).catch((error) => setStatus(error.message));
        }}
      />
      <aside className="sidebar">
        <div
          className="dragbar"
          data-tauri-drag-region
          onPointerDown={(event) => (dragStart.current = { x: event.screenX, y: event.screenY })}
          onPointerUp={finishDrag}
        >
          <div className="brand">
            <span className="mark" />
            <strong>Side Note</strong>
          </div>
          <button title="New note" onClick={createNote}><Plus size={18} /></button>
        </div>

        <label className="search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
        </label>

        <div className="tag-strip">
          <button className={!activeTag ? "active" : ""} onClick={() => setActiveTag(null)}>All</button>
          {tags.map((tag) => (
            <button key={tag.id} className={activeTag === tag.id ? "active" : ""} onClick={() => setActiveTag(tag.id)}>
              <span style={{ background: tag.color }} />{tag.name}
            </button>
          ))}
        </div>

        <div className="note-list">
          {notes.map((note) => (
            <button
              key={note.id}
              className={`note-card ${note.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(note.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveId(note.id);
                setNoteMenu({ noteId: note.id, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="color-pin" style={{ background: note.color }} />
              <strong>{note.title}</strong>
              <small>{note.content_markdown.replace(/[#*_>`\-\[\]]/g, "").slice(0, 88) || "Empty note"}</small>
              <span className="meta">{new Date(note.updated_at).toLocaleString()}</span>
            </button>
          ))}
        </div>
        {noteMenu && (
          <div
            className="note-context-menu"
            style={{ left: noteMenu.x, top: noteMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button onClick={() => archiveNoteById(noteMenu.noteId)}><Archive size={15} />Archive</button>
            <button onClick={() => deleteNoteById(noteMenu.noteId)}><Trash2 size={15} />Delete</button>
            <button onClick={() => startImportText(noteMenu.noteId)}><Plus size={15} />Import Text</button>
          </div>
        )}

        <label className="archive-toggle">
          <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
          Show archived
        </label>
      </aside>

      <section className="workspace">
        <header
          className="toolbar"
          data-tauri-drag-region
          onPointerDown={(event) => (dragStart.current = { x: event.screenX, y: event.screenY })}
          onPointerUp={finishDrag}
        >
          <div className="window-tools">
            <button title="Dock left" onClick={() => dock("left")}><ChevronLeft size={17} /></button>
            <button title="Fullscreen" onClick={() => api.toggleFullscreen().then(() => setIsDocked(false))}><Maximize2 size={16} /></button>
            <button title="Dock right" onClick={() => dock("right")}><ChevronRight size={17} /></button>
          </div>
          <div className="segmented">
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} />Preview</button>
            <button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}><Code size={15} />Source</button>
          </div>
        </header>

        <div className="editor-head">
          <input
            className="title"
            value={draft.title}
            readOnly={draft.is_read_only}
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
          <div className="swatches">
            {palette.map((color) => (
              <button key={color} className={draft.color === color ? "active" : ""} style={{ background: color }} onClick={() => updateDraft({ color })} />
            ))}
          </div>
        </div>

        <div className="tag-editor">
          <TagIcon size={15} />
          {tags.map((tag) => (
            <button key={tag.id} className={draft.tags.some((item) => item.id === tag.id) ? "active" : ""} onClick={() => toggleTag(tag)}>
              <span style={{ background: tag.color }} />{tag.name}
            </button>
          ))}
          <button onClick={addTag}><Plus size={14} />Tag</button>
        </div>

        <section className="editor-panel">
          {draft.is_read_only ? (
            <NovelReader
              content={draft.content_markdown}
              page={draft.reading_page}
              onPageChange={setReadingPage}
            />
          ) : mode === "source" ? (
            <textarea
              className="source-editor"
              value={draft.content_markdown}
              onChange={(event) => updateDraft({ content_markdown: event.target.value })}
              spellCheck
            />
          ) : (
            <WysiwygEditor
              key={activeId ?? "new"}
              value={draft.content_markdown}
              onChange={(content_markdown) => updateDraft({ content_markdown })}
              onLinkClick={handleLinkClick}
            />
          )}
        </section>

        <footer className="actions">
          <div className="reminders">
            <div className="reminder-menu">
              <button
                className="bell-button"
                title="Set reminder"
                onClick={() => {
                  if (!reminderMenuOpen) {
                    setReminderAt(reminderPartsFromDate(new Date(Date.now() + 15 * 60_000)));
                  }
                  setReminderMenuOpen((open) => !open);
                }}
              >
                <Bell size={16} />
              </button>
              {reminderMenuOpen && (
                <div className="reminder-popover">
                  <div className="reminder-presets">
                    {reminderPresets.map((preset) => (
                      <button key={preset.label} onClick={() => setReminder(preset.minutes)}>{preset.label}</button>
                    ))}
                  </div>
                  <div className="exact-reminder">
                    <input aria-label="Year" value={reminderAt.year} onChange={(event) => updateReminderPart("year", event.target.value)} />
                    <input aria-label="Month" value={reminderAt.month} onChange={(event) => updateReminderPart("month", event.target.value)} />
                    <input aria-label="Day" value={reminderAt.day} onChange={(event) => updateReminderPart("day", event.target.value)} />
                    <input aria-label="Hour" value={reminderAt.hour} onChange={(event) => updateReminderPart("hour", event.target.value)} />
                    <input aria-label="Minute" value={reminderAt.minute} onChange={(event) => updateReminderPart("minute", event.target.value)} />
                    <input aria-label="Second" value={reminderAt.second} onChange={(event) => updateReminderPart("second", event.target.value)} />
                    <button onClick={setReminderAtTime}><Check size={14} />Set</button>
                  </div>
                </div>
              )}
            </div>
            {draft.reminders.map((reminder) => (
              <button key={reminder.id} className={`reminder-pill${dueClass(reminder)}`} onClick={() => api.dismissReminder(reminder.id).then(refresh)}>
                <Check size={13} />{new Date(reminder.remind_at).toLocaleString()}
              </button>
            ))}
          </div>
          <div className="note-actions">
            <button onClick={handleArchive}><Archive size={16} />{draft.is_archived ? "Restore" : "Archive"}</button>
            <button onClick={handleDelete}><Trash2 size={16} />Delete</button>
            <span>{status}</span>
          </div>
        </footer>
      </section>
    </main>
  );
}

function NovelReader({
  content,
  page,
  onPageChange
}: {
  content: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const readerRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const wheelAccumulator = useRef(0);
  const lastWheelTurnAt = useRef(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const [fontSize, setFontSize] = useState(loadNovelFontSize);
  const [pageInput, setPageInput] = useState("1");
  const [pages, setPages] = useState<string[]>(() => splitNovelPages(content));
  const currentPage = Math.max(0, Math.min(page, pages.length - 1));
  const canGoBack = currentPage > 0;
  const canGoForward = currentPage < pages.length - 1;

  useEffect(() => {
    const element = readerRef.current;
    if (!element) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setLayoutTick((tick) => tick + 1), 120);
    });
    observer.observe(element);
    return () => {
      if (timer) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || pageEl.clientWidth <= 0 || pageEl.clientHeight <= 0) return;

    if (!measureRef.current) {
      const measureEl = document.createElement("div");
      measureEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(measureEl);
      measureRef.current = measureEl;
    }

    syncNovelMeasureEl(pageEl, measureRef.current, fontSize);
    const nextPages = paginateNovelByLayout(measureRef.current, pageEl.clientHeight, content);
    setPages((current) => (current.length === nextPages.length && current.every((value, index) => value === nextPages[index])
      ? current
      : nextPages));
  }, [content, fontSize]);

  useEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl || pageEl.clientWidth <= 0 || pageEl.clientHeight <= 0) return;

    if (!measureRef.current) return;

    syncNovelMeasureEl(pageEl, measureRef.current, fontSize);
    const nextPages = paginateNovelByLayout(measureRef.current, pageEl.clientHeight, content);
    setPages((current) => (current.length === nextPages.length && current.every((value, index) => value === nextPages[index])
      ? current
      : nextPages));
  }, [content, fontSize, layoutTick]);

  useEffect(() => () => {
    measureRef.current?.remove();
    measureRef.current = null;
  }, []);

  useEffect(() => {
    if (pages.length > 0 && page >= pages.length) {
      onPageChange(pages.length - 1);
    }
  }, [onPageChange, page, pages.length]);

  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  const turn = useCallback((direction: -1 | 1) => {
    const newPage = currentPage + direction;
    if (newPage >= 0 && newPage < pages.length) {
      onPageChange(newPage);
    }
  }, [currentPage, onPageChange, pages.length]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.classList.contains("novel-page-input")) return;
      if (event.key === "ArrowLeft") turn(-1);
      else if (event.key === "ArrowRight") turn(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [turn]);

  function jumpToPageInput() {
    const parsed = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage + 1));
      return;
    }
    const clamped = Math.min(pages.length, Math.max(1, parsed));
    onPageChange(clamped - 1);
    setPageInput(String(clamped));
  }

  function handlePageInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToPageInput();
    } else if (event.key === "Escape") {
      setPageInput(String(currentPage + 1));
      event.currentTarget.blur();
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey) {
      event.preventDefault();
      const step = event.deltaY > 0 ? -1 : 1;
      setFontSize((current) => {
        const next = Math.min(NOVEL_FONT_MAX, Math.max(NOVEL_FONT_MIN, current + step));
        localStorage.setItem(NOVEL_FONT_SIZE_KEY, String(next));
        return next;
      });
      return;
    }

    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelTurnAt.current < WHEEL_TURN_COOLDOWN_MS) return;

    wheelAccumulator.current += event.deltaY;
    if (Math.abs(wheelAccumulator.current) < WHEEL_TURN_THRESHOLD) return;

    const direction = wheelAccumulator.current > 0 ? 1 : -1;
    wheelAccumulator.current = 0;
    lastWheelTurnAt.current = now;
    turn(direction as -1 | 1);
  }

  function handlePageClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio < 0.35 && canGoBack) turn(-1);
    else if (ratio > 0.65 && canGoForward) turn(1);
  }

  return (
    <article className="novel-reader" ref={readerRef} tabIndex={-1}>
      <div
        ref={pageRef}
        className="novel-page"
        style={{ fontSize: `${fontSize}px`, lineHeight: NOVEL_LINE_HEIGHT }}
        onClick={handlePageClick}
        onWheel={handleWheel}
        title="Click edges to turn pages; scroll to turn; Ctrl+scroll to resize text"
      >
        {pages[currentPage].split("\n").map((line, index) => (
          <p key={`${currentPage}-${index}`}>{line || "\u00a0"}</p>
        ))}
      </div>
      <nav className="novel-nav" aria-label="Page navigation">
        <button
          type="button"
          className="novel-nav-btn"
          title="Previous page"
          onClick={() => turn(-1)}
          disabled={!canGoBack}
        >
          <ChevronLeft size={17} />
          Previous
        </button>
        <div className="novel-progress">
          <input
            className="novel-page-input"
            type="text"
            inputMode="numeric"
            aria-label="Current page"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
            onKeyDown={handlePageInputKeyDown}
            onBlur={jumpToPageInput}
          />
          <span className="novel-page-total">/ {pages.length}</span>
        </div>
        <button
          type="button"
          className="novel-nav-btn"
          title="Next page"
          onClick={() => turn(1)}
          disabled={!canGoForward}
        >
          Next
          <ChevronRight size={17} />
        </button>
      </nav>
    </article>
  );
}
