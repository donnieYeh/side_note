use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use arboard::Clipboard;
use chrono::Utc;
use log;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, PhysicalPosition, Position, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_log::{Target, TargetKind};
use uuid::Uuid;
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

const EDGE_PEEK_PX: i32 = 14;
const EDGE_HINT_PX: u32 = 6;
const EDGE_HINT_NUMERATOR: i32 = 1;
const EDGE_HINT_DENOMINATOR: i32 = 3;
const DEFAULT_WIDTH: u32 = 980;
const DEFAULT_HEIGHT: u32 = 640;
const DOCK_LEAVE_COLLAPSE_FAST_MS: u64 = 150;
const DOCK_LEAVE_COLLAPSE_SMOOTH_MS: u64 = 900;
const EDGE_REVEAL_DELAY_MS: u64 = 1000;
const DOCK_ANIM_STEPS: i32 = 14;
const DOCK_ANIM_STEP_MS: u64 = 10;

struct AppState {
    db: Mutex<Connection>,
    dock: Mutex<DockState>,
}

#[derive(Debug)]
struct DockState {
    side: Option<EdgeSide>,
    collapsed: bool,
    animating: bool,
    hint_side: Option<EdgeSide>,
    fast_dock: bool,
}

#[derive(Debug, Serialize)]
struct Note {
    id: String,
    title: String,
    content_markdown: String,
    color: String,
    is_archived: bool,
    is_pinned: bool,
    is_read_only: bool,
    reading_page: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct Tag {
    id: String,
    name: String,
    color: String,
}

#[derive(Debug, Serialize)]
struct Reminder {
    id: String,
    note_id: String,
    task_anchor: Option<String>,
    remind_at: String,
    status: String,
    created_at: String,
    triggered_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct NoteWithMeta {
    #[serde(flatten)]
    note: Note,
    tags: Vec<Tag>,
    reminders: Vec<Reminder>,
}

#[derive(Debug, Deserialize)]
struct SaveNoteInput {
    id: Option<String>,
    title: String,
    content_markdown: String,
    color: String,
    is_archived: Option<bool>,
    is_pinned: Option<bool>,
    is_read_only: Option<bool>,
    reading_page: Option<i64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum EdgeSide {
    Left,
    Right,
}

fn log_level() -> log::LevelFilter {
    let level = std::env::var("SIDE_NOTE_LOG")
        .or_else(|_| std::env::var("RUST_LOG"))
        .unwrap_or_else(|_| "info".into());
    match level.to_lowercase().as_str() {
        "debug" | "trace" => log::LevelFilter::Debug,
        "warn" | "warning" => log::LevelFilter::Warn,
        "error" => log::LevelFilter::Error,
        _ => log::LevelFilter::Info,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([Target::new(TargetKind::LogDir {
                    file_name: Some("side-note".into()),
                })])
                .level(log_level())
                .build(),
        )
        .setup(|app| {
            let db_path = app_data_path(app.handle())?;
            log::info!("Side Note starting; data dir={:?}", db_path.parent());
            let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
            init_db(&conn).map_err(|error| error.to_string())?;
            seed_db(&conn).map_err(|error| error.to_string())?;
            app.manage(AppState {
                db: Mutex::new(conn),
                dock: Mutex::new(DockState {
                    side: None,
                    collapsed: false,
                    animating: false,
                    hint_side: None,
                    fast_dock: false,
                }),
            });
            configure_edge_hint(app)?;
            configure_window(app)?;
            dock_on_startup(app.handle());
            start_mouse_release_watcher(app.handle().clone());
            configure_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            list_tags,
            save_note,
            update_reading_page,
            delete_note,
            archive_note,
            upsert_tag,
            set_note_tags,
            schedule_reminder,
            dismiss_reminder,
            due_reminders,
            reveal_reminder,
            dock_window,
            dock_if_near_edge,
            dock_nearest_window,
            is_dock_collapsed,
            undock_window,
            set_dock_fast_mode,
            toggle_fullscreen,
            set_always_on_top,
            copy_text,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Side Note");
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("side-note.sqlite3"))
}

fn configure_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(false)?;
        window.set_resizable(false)?;
        window.set_skip_taskbar(true)?;
        let close_window = window.clone();
        let moved_window = window.clone();
        let focused_window = window.clone();
        let focus_app_handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = close_window.hide();
            }
            if let WindowEvent::Focused(false) = event {
                let window = focused_window.clone();
                let app = focus_app_handle.clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(220));
                    if window.is_fullscreen().unwrap_or(false) {
                        return;
                    }
                    if window.is_focused().unwrap_or(false) {
                        return;
                    }
                    let state = app.state::<AppState>();
                    let side = {
                        let dock = match state.dock.lock() {
                            Ok(dock) => dock,
                            Err(_) => return,
                        };
                        if dock.animating || dock.collapsed {
                            return;
                        }
                        dock.side
                    };
                    if side.is_some() {
                        request_dock_toggle(&app, side, false, true);
                    }
                });
            }
            if let WindowEvent::Moved(_) = event {
                if moved_window.is_fullscreen().unwrap_or(false) {
                    hide_edge_hint(&moved_window);
                    return;
                }
                let _ = update_edge_hint(&moved_window);
                let _ = update_floating_top_state(&moved_window);
            }
        });
    }
    Ok(())
}

fn dock_on_startup(app: &tauri::AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(180));
        request_dock_toggle(&app, Some(EdgeSide::Right), false, true);
    });
}

fn dock_leave_delay_ms(fast_dock: bool) -> u64 {
    if fast_dock {
        DOCK_LEAVE_COLLAPSE_FAST_MS
    } else {
        DOCK_LEAVE_COLLAPSE_SMOOTH_MS
    }
}

fn request_dock_toggle(
    app: &tauri::AppHandle,
    side: Option<EdgeSide>,
    reveal: bool,
    collapsed_after: bool,
) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if window.is_fullscreen().unwrap_or(false) {
            return;
        }
        let state = app.state::<AppState>();
        let _ = animate_window_with_state(&window, &state, side, reveal, collapsed_after);
    });
}

fn pointer_near_dock_window(window: &WebviewWindow) -> bool {
    cursor_in_window(window).unwrap_or(false) || cursor_in_visible_edge(window).unwrap_or(false)
}

fn start_mouse_release_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut was_down = false;
        let mut peek_armed = false;
        let mut edge_entered_at: Option<Instant> = None;
        let mut pointer_was_inside = false;
        let mut collapse_scheduled = false;
        loop {
            let is_down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 };
            if was_down && !is_down {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_fullscreen().unwrap_or(false) {
                        was_down = is_down;
                        thread::sleep(Duration::from_millis(35));
                        continue;
                    }
                    let side = {
                        let state = app.state::<AppState>();
                        let dock = match state.dock.lock() {
                            Ok(dock) => dock,
                            Err(_) => {
                                was_down = is_down;
                                thread::sleep(Duration::from_millis(35));
                                continue;
                            }
                        };
                        if dock.animating || dock.collapsed {
                            None
                        } else {
                            dock.hint_side
                        }
                    };
                    if side.is_some() {
                        request_dock_toggle(&app, side, false, true);
                    }
                }
            }
            if !is_down {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_fullscreen().unwrap_or(false) {
                        was_down = is_down;
                        thread::sleep(Duration::from_millis(35));
                        continue;
                    }
                    let (collapsed, side, animating, leave_delay_ms) = {
                        let state = app.state::<AppState>();
                        let dock = match state.dock.lock() {
                            Ok(dock) => dock,
                            Err(_) => {
                                was_down = is_down;
                                thread::sleep(Duration::from_millis(35));
                                continue;
                            }
                        };
                        (
                            dock.collapsed,
                            dock.side,
                            dock.animating,
                            dock_leave_delay_ms(dock.fast_dock),
                        )
                    };
                    let at_edge = cursor_in_visible_edge(&window).unwrap_or(false);
                    let pointer_inside = if !collapsed && at_edge {
                        true
                    } else {
                        pointer_near_dock_window(&window)
                    };

                    if collapsed {
                        pointer_was_inside = false;
                        collapse_scheduled = false;
                        if !at_edge {
                            peek_armed = false;
                            edge_entered_at = None;
                        } else if animating {
                            edge_entered_at = None;
                        } else if !peek_armed {
                            match edge_entered_at {
                                None => edge_entered_at = Some(Instant::now()),
                                Some(started)
                                    if started.elapsed()
                                        >= Duration::from_millis(EDGE_REVEAL_DELAY_MS) =>
                                {
                                    peek_armed = true;
                                    edge_entered_at = None;
                                    request_dock_toggle(&app, side, true, false);
                                }
                                Some(_) => {}
                            }
                        }
                    } else {
                        if !at_edge {
                            peek_armed = false;
                            edge_entered_at = None;
                        }
                        if pointer_inside {
                            pointer_was_inside = true;
                            collapse_scheduled = false;
                        } else if pointer_was_inside && !collapse_scheduled && !animating && side.is_some() {
                            pointer_was_inside = false;
                            collapse_scheduled = true;
                            let app = app.clone();
                            thread::spawn(move || {
                                thread::sleep(Duration::from_millis(leave_delay_ms));
                                let Some(window) = app.get_webview_window("main") else {
                                    return;
                                };
                                if window.is_fullscreen().unwrap_or(false) {
                                    return;
                                }
                                if pointer_near_dock_window(&window) {
                                    return;
                                }
                                let state = app.state::<AppState>();
                                let side = state
                                    .dock
                                    .lock()
                                    .ok()
                                    .and_then(|dock| {
                                        if dock.animating || dock.collapsed {
                                            None
                                        } else {
                                            dock.side
                                        }
                                    });
                                if side.is_some() {
                                    request_dock_toggle(&app, side, false, true);
                                }
                            });
                        }
                    }
                }
            }
            was_down = is_down;
            thread::sleep(Duration::from_millis(35));
        }
    });
}

fn configure_edge_hint(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let hint = WebviewWindowBuilder::new(
        app,
        "edge_hint",
        WebviewUrl::App("edge-hint.html".into()),
    )
    .title("Dock hint")
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .inner_size(EDGE_HINT_PX as f64, DEFAULT_HEIGHT as f64)
    .position(-100.0, -100.0)
    .build()?;
    hint.set_ignore_cursor_events(true)?;
    Ok(())
}

fn configure_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let state = app.state::<AppState>();
                    let side = state
                        .dock
                        .lock()
                        .ok()
                        .and_then(|dock| if dock.collapsed { dock.side } else { None });
                    if side.is_some() {
                        let _ = animate_window_with_state(&window, &state, side, true, false);
                    }
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        pragma foreign_keys = on;

        create table if not exists notes (
          id text primary key,
          title text not null,
          content_markdown text not null,
          color text not null,
          is_archived integer not null default 0,
          is_pinned integer not null default 0,
          is_read_only integer not null default 0,
          reading_page integer not null default 0,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists tags (
          id text primary key,
          name text not null unique,
          color text not null
        );

        create table if not exists note_tags (
          note_id text not null references notes(id) on delete cascade,
          tag_id text not null references tags(id) on delete cascade,
          primary key (note_id, tag_id)
        );

        create table if not exists reminders (
          id text primary key,
          note_id text not null references notes(id) on delete cascade,
          task_anchor text,
          remind_at text not null,
          status text not null default 'scheduled',
          created_at text not null,
          triggered_at text
        );

        create table if not exists app_settings (
          key text primary key,
          value text not null
        );
        "#,
    )?;
    ensure_column(conn, "notes", "is_read_only", "integer not null default 0")?;
    ensure_column(conn, "notes", "reading_page", "integer not null default 0")
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("pragma table_info({})", table))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }
    conn.execute(&format!("alter table {} add column {} {}", table, column, definition), [])?;
    Ok(())
}

fn seed_db(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("select count(*) from notes", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let now = Utc::now().to_rfc3339();
    let note_id = Uuid::new_v4().to_string();
    let tag_id = Uuid::new_v4().to_string();
    conn.execute(
        "insert into notes (id, title, content_markdown, color, is_archived, is_pinned, created_at, updated_at)
         values (?1, ?2, ?3, ?4, 0, 1, ?5, ?5)",
        params![
            note_id,
            "Side Note",
            "# 今日便签\n\n- [ ] 把窗口拖到左右边缘试试贴边收起\n- [ ] 给事项设置提醒\n\n链接示例：[OpenAI](https://openai.com)\n\n普通点击复制链接，Ctrl + 点击打开。",
            "#d8b86a",
            now
        ],
    )?;
    conn.execute(
        "insert into tags (id, name, color) values (?1, 'Inbox', '#5f7d6a')",
        params![tag_id],
    )?;
    conn.execute(
        "insert into note_tags (note_id, tag_id) values (?1, ?2)",
        params![note_id, tag_id],
    )?;
    Ok(())
}

#[tauri::command]
fn list_notes(
    state: State<AppState>,
    query: String,
    tag_id: Option<String>,
    include_archived: bool,
) -> Result<Vec<NoteWithMeta>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let search = format!("%{}%", query.trim());
    let mut stmt = conn
        .prepare(
            r#"
            select distinct n.id, n.title, n.content_markdown, n.color, n.is_archived, n.is_pinned, n.is_read_only, n.reading_page, n.created_at, n.updated_at
            from notes n
            left join note_tags nt on nt.note_id = n.id
            where (?1 = 1 or n.is_archived = 0)
              and (?2 = '' or n.title like ?3 or n.content_markdown like ?3)
              and (?4 is null or nt.tag_id = ?4)
            order by n.is_pinned desc, n.updated_at desc
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map(
            params![
                if include_archived { 1 } else { 0 },
                query.trim(),
                search,
                tag_id
            ],
            |row| read_note(row),
        )
        .map_err(|error| error.to_string())?;

    let mut notes = Vec::new();
    for row in rows {
        let note = row.map_err(|error| error.to_string())?;
        let tags = tags_for_note(&conn, &note.id).map_err(|error| error.to_string())?;
        let reminders = reminders_for_note(&conn, &note.id).map_err(|error| error.to_string())?;
        notes.push(NoteWithMeta {
            note,
            tags,
            reminders,
        });
    }
    Ok(notes)
}

#[tauri::command]
fn list_tags(state: State<AppState>) -> Result<Vec<Tag>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    cleanup_orphan_tags(&conn).map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare("select id, name, color from tags order by lower(name)")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_note(state: State<AppState>, note: SaveNoteInput) -> Result<NoteWithMeta, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = note.id.filter(|value| !value.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
    let exists: Option<String> = conn
        .query_row("select id from notes where id = ?1", params![id], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?;

    if exists.is_some() {
        conn.execute(
            "update notes set title = ?2, content_markdown = ?3, color = ?4, is_archived = coalesce(?5, is_archived), is_pinned = coalesce(?6, is_pinned), is_read_only = coalesce(?7, is_read_only), reading_page = coalesce(?8, reading_page), updated_at = ?9 where id = ?1",
            params![
                id,
                note.title,
                note.content_markdown,
                note.color,
                note.is_archived.map(bool_to_i64),
                note.is_pinned.map(bool_to_i64),
                note.is_read_only.map(bool_to_i64),
                note.reading_page,
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    } else {
        conn.execute(
            "insert into notes (id, title, content_markdown, color, is_archived, is_pinned, is_read_only, reading_page, created_at, updated_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                id,
                note.title,
                note.content_markdown,
                note.color,
                note.is_archived.map(bool_to_i64).unwrap_or(0),
                note.is_pinned.map(bool_to_i64).unwrap_or(0),
                note.is_read_only.map(bool_to_i64).unwrap_or(0),
                note.reading_page.unwrap_or(0),
                now
            ],
        )
        .map_err(|error| error.to_string())?;
    }

    note_with_meta(&conn, &id).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_reading_page(state: State<AppState>, note_id: String, reading_page: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "update notes set reading_page = ?2, updated_at = ?3 where id = ?1",
        params![note_id, reading_page.max(0), Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_note(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute("delete from notes where id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    cleanup_orphan_tags(&conn).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn archive_note(state: State<AppState>, id: String, archived: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "update notes set is_archived = ?2, updated_at = ?3 where id = ?1",
        params![id, bool_to_i64(archived), Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn upsert_tag(state: State<AppState>, name: String, color: String) -> Result<Tag, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".into());
    }
    if let Some(tag) = conn
        .query_row(
            "select id, name, color from tags where lower(name) = lower(?1)",
            params![trimmed],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
    {
        return Ok(tag);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "insert into tags (id, name, color) values (?1, ?2, ?3)",
        params![id, trimmed, color],
    )
    .map_err(|error| error.to_string())?;
    Ok(Tag {
        id,
        name: trimmed.to_string(),
        color,
    })
}

#[tauri::command]
fn set_note_tags(state: State<AppState>, note_id: String, tag_ids: Vec<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|error| error.to_string())?;
    tx.execute("delete from note_tags where note_id = ?1", params![note_id])
        .map_err(|error| error.to_string())?;
    for tag_id in tag_ids {
        tx.execute(
            "insert or ignore into note_tags (note_id, tag_id) values (?1, ?2)",
            params![note_id, tag_id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    cleanup_orphan_tags(&conn).map_err(|error| error.to_string())?;
    Ok(())
}

fn cleanup_orphan_tags(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "delete from tags where not exists (select 1 from note_tags nt where nt.tag_id = tags.id)",
        [],
    )?;
    Ok(())
}

#[tauri::command]
fn schedule_reminder(
    state: State<AppState>,
    note_id: String,
    task_anchor: Option<String>,
    remind_at: String,
) -> Result<Reminder, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "insert into reminders (id, note_id, task_anchor, remind_at, status, created_at)
         values (?1, ?2, ?3, ?4, 'scheduled', ?5)",
        params![id, note_id, task_anchor, remind_at, now],
    )
    .map_err(|error| error.to_string())?;
    reminder_by_id(&conn, &id).map_err(|error| error.to_string())
}

#[tauri::command]
fn dismiss_reminder(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    conn.execute(
        "update reminders set status = 'dismissed' where id = ?1",
        params![id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn due_reminders(state: State<AppState>) -> Result<Vec<Reminder>, String> {
    let conn = state.db.lock().map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "update reminders set status = 'triggered', triggered_at = ?1 where status = 'scheduled' and remind_at <= ?1",
        params![now],
    )
    .map_err(|error| error.to_string())?;

    let mut stmt = conn
        .prepare(
            "select id, note_id, task_anchor, remind_at, status, created_at, triggered_at
             from reminders where status = 'triggered' order by remind_at asc",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], read_reminder)
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn reveal_reminder(window: WebviewWindow, note_id: String, reminder_id: String) -> Result<(), String> {
    let _ = (note_id, reminder_id);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    animate_window(&window, None, true, false)
}

#[tauri::command]
fn dock_window(window: WebviewWindow, state: State<AppState>, side: EdgeSide) -> Result<(), String> {
    animate_window_with_state(&window, &state, Some(side), false, true)
}

#[tauri::command]
fn dock_if_near_edge(window: WebviewWindow) -> Result<bool, String> {
    dock_if_near_edge_impl(&window)
}

fn dock_if_near_edge_impl(window: &WebviewWindow) -> Result<bool, String> {
    hide_edge_hint(window);
    let monitor = active_monitor(&window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let left_edge = monitor_pos.x;
    let right_edge = monitor_pos.x + monitor_size.width as i32;
    let hint_offset = edge_hint_offset(outer_size.width);
    let deeply_out_left = current.x <= left_edge - hint_offset;
    let deeply_out_right = current.x + outer_size.width as i32 >= right_edge + hint_offset;

    if deeply_out_left {
        animate_window(&window, Some(EdgeSide::Left), false, true)?;
        return Ok(true);
    }
    if deeply_out_right {
        animate_window(&window, Some(EdgeSide::Right), false, true)?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn dock_nearest_window(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    let side = state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .side;
    animate_window_with_state(&window, &state, side, false, true)
}

#[tauri::command]
fn is_dock_collapsed(state: State<AppState>) -> Result<bool, String> {
    Ok(state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .collapsed)
}

#[tauri::command]
fn undock_window(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    let side = state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .side;
    animate_window_with_state(&window, &state, side, true, false)
}

#[tauri::command]
fn set_dock_fast_mode(state: State<AppState>, enabled: bool) -> Result<(), String> {
    state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .fast_dock = enabled;
    Ok(())
}

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow, state: State<AppState>) -> Result<bool, String> {
    let currently_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    if currently_fullscreen {
        window
            .set_fullscreen(false)
            .map_err(|error| error.to_string())?;
        let side = state
            .dock
            .lock()
            .map_err(|error| error.to_string())?
            .side;
        if side.is_some() {
            thread::sleep(Duration::from_millis(120));
            animate_window_with_state(&window, &state, side, false, true)?;
        }
        Ok(false)
    } else {
        hide_edge_hint(&window);
        {
            let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
            dock.collapsed = false;
            dock.hint_side = None;
        }
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        window
            .set_fullscreen(true)
            .map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    open::that(url).map_err(|error| error.to_string())
}

fn animate_window(
    window: &WebviewWindow,
    side: Option<EdgeSide>,
    reveal: bool,
    collapsed_after: bool,
) -> Result<(), String> {
    let state = window.state::<AppState>();
    animate_window_with_state(window, &state, side, reveal, collapsed_after)
}

fn animate_window_with_state(
    window: &WebviewWindow,
    state: &State<AppState>,
    side: Option<EdgeSide>,
    reveal: bool,
    collapsed_after: bool,
) -> Result<(), String> {
    {
        let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
        if dock.animating {
            return Ok(());
        }
        if dock.collapsed == collapsed_after {
            return Ok(());
        }
        dock.animating = true;
    }

    let result = animate_window_inner(window, state, side, reveal, collapsed_after);

    let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
    dock.animating = false;
    result
}

fn animate_window_inner(
    window: &WebviewWindow,
    state: &State<AppState>,
    side: Option<EdgeSide>,
    reveal: bool,
    collapsed_after: bool,
) -> Result<(), String> {
    hide_edge_hint(window);
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    let monitor = active_monitor(window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let side = side.unwrap_or_else(|| {
        let screen_mid = monitor_pos.x + monitor_size.width as i32 / 2;
        if current.x + outer_size.width as i32 / 2 < screen_mid {
            EdgeSide::Left
        } else {
            EdgeSide::Right
        }
    });

    let target_x = match (side, reveal) {
        (EdgeSide::Left, false) => monitor_pos.x - outer_size.width as i32 + EDGE_PEEK_PX,
        (EdgeSide::Right, false) => monitor_pos.x + monitor_size.width as i32 - EDGE_PEEK_PX,
        (EdgeSide::Left, true) => monitor_pos.x,
        (EdgeSide::Right, true) => monitor_pos.x + monitor_size.width as i32 - outer_size.width as i32,
    };
    let min_y = monitor_pos.y;
    let max_y = monitor_pos.y + monitor_size.height as i32 - outer_size.height as i32;
    let target_y = current.y.clamp(min_y, max_y);

    if outer_size.width == 0 || outer_size.height == 0 {
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
            }))
            .map_err(|error| error.to_string())?;
    }

    let fast_dock = state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .fast_dock;

    if fast_dock {
        window
            .set_position(Position::Physical(PhysicalPosition {
                x: target_x,
                y: target_y,
            }))
            .map_err(|error| error.to_string())?;
    } else {
        let steps = DOCK_ANIM_STEPS;
        let start_x = current.x;
        let start_y = current.y;
        for step in 1..=steps {
            let t = step as f32 / steps as f32;
            let eased = 1.0 - (1.0 - t).powi(3);
            let x = start_x + ((target_x - start_x) as f32 * eased).round() as i32;
            let y = start_y + ((target_y - start_y) as f32 * eased).round() as i32;
            window
                .set_position(Position::Physical(PhysicalPosition { x, y }))
                .map_err(|error| error.to_string())?;
            thread::sleep(Duration::from_millis(DOCK_ANIM_STEP_MS));
        }
    }

    let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
    dock.side = Some(side);
    dock.collapsed = collapsed_after;
    dock.hint_side = None;
    Ok(())
}

fn update_edge_hint(window: &WebviewWindow) -> Result<(), String> {
    let monitor = active_monitor(window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let left_edge = monitor_pos.x;
    let right_edge = monitor_pos.x + monitor_size.width as i32;
    let hint_offset = edge_hint_offset(outer_size.width);
    let deeply_out_left = current.x <= left_edge - hint_offset;
    let deeply_out_right = current.x + outer_size.width as i32 >= right_edge + hint_offset;

    let Some(side) = (if deeply_out_left {
        Some(EdgeSide::Left)
    } else if deeply_out_right {
        Some(EdgeSide::Right)
    } else {
        None
    }) else {
        hide_edge_hint(window);
        let state = window.state::<AppState>();
        if let Ok(mut dock) = state.dock.lock() {
            dock.hint_side = None;
        }
        return Ok(());
    };

    let state = window.state::<AppState>();
    {
        let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
        dock.hint_side = Some(side);
    }
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;

    let Some(hint) = window.app_handle().get_webview_window("edge_hint") else {
        return Ok(());
    };
    let x = match side {
        EdgeSide::Left => left_edge,
        EdgeSide::Right => right_edge - EDGE_HINT_PX as i32,
    };
    let max_y = monitor_pos.y + monitor_size.height as i32 - outer_size.height as i32;
    let y = current.y.clamp(monitor_pos.y, max_y);
    hint.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: EDGE_HINT_PX,
        height: outer_size.height.max(1),
    }))
    .map_err(|error| error.to_string())?;
    hint.set_position(Position::Physical(PhysicalPosition { x, y }))
        .map_err(|error| error.to_string())?;
    hint.show().map_err(|error| error.to_string())?;
    Ok(())
}

fn update_floating_top_state(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<AppState>();
    let mut dock = state.dock.lock().map_err(|error| error.to_string())?;
    if dock.animating {
        return Ok(());
    }

    if dock.collapsed || dock.hint_side.is_some() || is_edge_expanded(window, dock.side)? {
        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    dock.side = None;
    dock.hint_side = None;
    window
        .set_always_on_top(false)
        .map_err(|error| error.to_string())
}

fn is_edge_expanded(window: &WebviewWindow, side: Option<EdgeSide>) -> Result<bool, String> {
    let Some(side) = side else {
        return Ok(false);
    };
    let monitor = active_monitor(window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let tolerance = 8;
    Ok(match side {
        EdgeSide::Left => (current.x - monitor_pos.x).abs() <= tolerance,
        EdgeSide::Right => {
            let target_x = monitor_pos.x + monitor_size.width as i32 - outer_size.width as i32;
            (current.x - target_x).abs() <= tolerance
        }
    })
}

fn edge_hint_offset(width: u32) -> i32 {
    width as i32 * EDGE_HINT_NUMERATOR / EDGE_HINT_DENOMINATOR
}

fn hide_edge_hint(window: &WebviewWindow) {
    if let Some(hint) = window.app_handle().get_webview_window("edge_hint") {
        let _ = hint.hide();
    }
}

fn cursor_in_visible_edge(window: &WebviewWindow) -> Result<bool, String> {
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point).map_err(|error| error.to_string())? };
    let monitor = active_monitor(window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let state = window.state::<AppState>();
    let side = state
        .dock
        .lock()
        .map_err(|error| error.to_string())?
        .side;

    let Some(side) = side else {
        return Ok(false);
    };

    let y_in_window = point.y >= current.y - 12 && point.y <= current.y + outer_size.height as i32 + 12;
    if !y_in_window {
        return Ok(false);
    }

    Ok(match side {
        EdgeSide::Left => {
            point.x >= monitor_pos.x && point.x <= monitor_pos.x + EDGE_PEEK_PX + 28
        }
        EdgeSide::Right => {
            let right_edge = monitor_pos.x + monitor_size.width as i32;
            point.x >= right_edge - EDGE_PEEK_PX - 28 && point.x <= right_edge
        }
    })
}

fn cursor_in_window(window: &WebviewWindow) -> Result<bool, String> {
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point).map_err(|error| error.to_string())? };
    let current = window.outer_position().map_err(|error| error.to_string())?;
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(
        point.x >= current.x
            && point.x <= current.x + outer_size.width as i32
            && point.y >= current.y
            && point.y <= current.y + outer_size.height as i32,
    )
}

fn active_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor available".to_string())
}

fn note_with_meta(conn: &Connection, id: &str) -> rusqlite::Result<NoteWithMeta> {
    let note = conn.query_row(
        "select id, title, content_markdown, color, is_archived, is_pinned, is_read_only, reading_page, created_at, updated_at from notes where id = ?1",
        params![id],
        read_note,
    )?;
    let tags = tags_for_note(conn, id)?;
    let reminders = reminders_for_note(conn, id)?;
    Ok(NoteWithMeta {
        note,
        tags,
        reminders,
    })
}

fn tags_for_note(conn: &Connection, note_id: &str) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "select t.id, t.name, t.color
         from tags t
         inner join note_tags nt on nt.tag_id = t.id
         where nt.note_id = ?1
         order by lower(t.name)",
    )?;
    let rows = stmt.query_map(params![note_id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
        })
    })?;
    rows.collect()
}

fn reminders_for_note(conn: &Connection, note_id: &str) -> rusqlite::Result<Vec<Reminder>> {
    let mut stmt = conn.prepare(
        "select id, note_id, task_anchor, remind_at, status, created_at, triggered_at
         from reminders
         where note_id = ?1 and status != 'dismissed'
         order by remind_at asc",
    )?;
    let rows = stmt.query_map(params![note_id], read_reminder)?;
    rows.collect()
}

fn reminder_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Reminder> {
    conn.query_row(
        "select id, note_id, task_anchor, remind_at, status, created_at, triggered_at from reminders where id = ?1",
        params![id],
        read_reminder,
    )
}

fn read_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        content_markdown: row.get(2)?,
        color: row.get(3)?,
        is_archived: row.get::<_, i64>(4)? != 0,
        is_pinned: row.get::<_, i64>(5)? != 0,
        is_read_only: row.get::<_, i64>(6)? != 0,
        reading_page: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn read_reminder(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id: row.get(0)?,
        note_id: row.get(1)?,
        task_anchor: row.get(2)?,
        remind_at: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        triggered_at: row.get(6)?,
    })
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}
