import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Maximize2,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2
} from "lucide-react";
import { api } from "./api";
import type { EdgeSide, NoteWithMeta, Reminder, Tag } from "./types";

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
  const [mode, setMode] = useState<"write" | "preview">("preview");
  const [status, setStatus] = useState("Ready");
  const [highlightReminder, setHighlightReminder] = useState<string | null>(null);
  const [isDocked, setIsDocked] = useState(true);
  const [reminderMenuOpen, setReminderMenuOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState<ReminderParts>(() => reminderPartsFromDate(new Date(Date.now() + 15 * 60_000)));
  const [noteMenu, setNoteMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);
  const [pendingImportNoteId, setPendingImportNoteId] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const collapseTimer = useRef<number | null>(null);
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

  async function revealDockedWindow() {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    if (!isDocked) return;
    await api.undockWindow();
  }

  function scheduleCollapse() {
    if (!isDocked) return;
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
      if (!editing) api.dockNearest().catch(() => undefined);
    }, 900);
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
      onMouseEnter={revealDockedWindow}
      onMouseLeave={scheduleCollapse}
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
            <button className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}><EyeOff size={15} />Edit</button>
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={15} />Read</button>
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
          ) : mode === "write" ? (
            <div className="split-editor">
              <textarea
                value={draft.content_markdown}
                onChange={(event) => updateDraft({ content_markdown: event.target.value })}
                spellCheck
              />
              <article className="markdown live">
                <MarkdownView content={draft.content_markdown} onLinkClick={handleLinkClick} />
              </article>
            </div>
          ) : (
            <article className="markdown read">
              <MarkdownView content={draft.content_markdown} onLinkClick={handleLinkClick} />
            </article>
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

function MarkdownView({
  content,
  onLinkClick
}: {
  content: string;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href?: string) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} onClick={(event) => onLinkClick(event, href)} title="Click to copy, Ctrl+click to open">
            <Copy size={12} />{children}
          </a>
        )
      }}
    >
      {content}
    </ReactMarkdown>
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
  const [pageSize, setPageSize] = useState(360);
  const pages = useMemo(() => splitNovelPages(content, pageSize), [content, pageSize]);
  const currentPage = Math.max(0, Math.min(page, pages.length - 1));
  const canGoBack = currentPage > 0;
  const canGoForward = currentPage < pages.length - 1;

  useEffect(() => {
    const element = readerRef.current;
    if (!element) return;

    const updatePageSize = () => {
      const width = Math.max(240, element.clientWidth - 108);
      const height = Math.max(180, element.clientHeight - 120);
      const charsPerLine = Math.max(12, Math.floor(width / 17));
      const linesPerPage = Math.max(6, Math.floor(height / 32));
      setPageSize(Math.max(180, Math.floor(charsPerLine * linesPerPage * 0.62)));
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pages.length > 0 && page >= pages.length) {
      onPageChange(pages.length - 1);
    }
  }, [onPageChange, page, pages.length]);

  const turn = useCallback((direction: -1 | 1) => {
    const newPage = currentPage + direction;
    if (newPage >= 0 && newPage < pages.length) {
      onPageChange(newPage);
    }
  }, [currentPage, onPageChange, pages.length]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") turn(-1);
      else if (event.key === "ArrowRight") turn(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [turn]);

  function handlePageClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio < 0.35 && canGoBack) turn(-1);
    else if (ratio > 0.65 && canGoForward) turn(1);
  }

  return (
    <article className="novel-reader" ref={readerRef} tabIndex={-1}>
      <div
        className="novel-page"
        onClick={handlePageClick}
        title="Click left or right edge to turn pages"
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
        <span className="novel-progress">
          {currentPage + 1} / {pages.length}
        </span>
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
