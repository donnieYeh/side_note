export type Note = {
  id: string;
  title: string;
  content_markdown: string;
  color: string;
  is_archived: boolean;
  is_pinned: boolean;
  is_read_only: boolean;
  reading_page: number;
  created_at: string;
  updated_at: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type Reminder = {
  id: string;
  note_id: string;
  task_anchor: string | null;
  remind_at: string;
  status: "scheduled" | "triggered" | "dismissed";
  created_at: string;
  triggered_at: string | null;
};

export type NoteWithMeta = Note & {
  tags: Tag[];
  reminders: Reminder[];
};

export type EdgeSide = "left" | "right";
