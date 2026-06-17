# Side Note

Dockable desktop sticky notes built with Tauri, React, TypeScript, and SQLite.

## Development

```powershell
npm install
npm run tauri:dev
```

Dev server runs on **http://localhost:5173** (5174 is often reserved by Windows/Hyper-V on some machines).

**If you also run other local Tauri apps** (e.g. Typemore on port 1420), keep Side Note on 5173. Both `vite.config.ts` and `src-tauri/tauri.conf.json` `devUrl` must use the same port — otherwise the Side Note window can load the wrong app's UI from a shared dev server.

To stop only this project's dev processes:

```powershell
npm run dev:stop
```

## Build Policy

Default packaging should produce only the standalone executable. Do not build MSI or NSIS installers unless explicitly requested.

Use:

```powershell
npm run tauri:build
```

Expected output:

```text
src-tauri/target/release/side-note.exe
```

The `tauri:build` script intentionally runs `tauri build --no-bundle` so future builds do not spend time producing installer packages.

Installer builds are kept as an explicit opt-in command only:

```powershell
npm run tauri:bundle
```

## Troubleshooting

Side Note writes application logs to help diagnose issues such as the window becoming unresponsive or popping out unexpectedly while typing in another app.

### Log file location

On Windows, logs are stored at:

```text
%APPDATA%\com.local.sidenote\logs\side-note.log
```

Open File Explorer, paste `%APPDATA%\com.local.sidenote` into the address bar, then open the `logs` folder.

The SQLite database lives in the same parent folder: `side-note.sqlite3`.

### Enable debug logging

Close Side Note, then start it from PowerShell with debug logging enabled:

```powershell
$env:SIDE_NOTE_LOG = "debug"
& "C:\path\to\side-note.exe"
```

You can also use `$env:RUST_LOG = "side_note=debug"` instead of `SIDE_NOTE_LOG`.

### Collecting logs for bug reports

**Unresponsive after fast clicks**

1. Start Side Note with debug logging (see above).
2. Reproduce the freeze by clicking quickly (note list, dock buttons, etc.).
3. Close the app and send `side-note.log`.

**Window pops out while typing elsewhere**

1. Start with debug logging.
2. Dock Side Note to an edge so it collapses to the peek strip.
3. Switch to another app (browser, Word, etc.) and type for 1–2 minutes.
4. Note whether your mouse or touchpad was near the screen edge when the window appeared.
5. Send `side-note.log`.

**Please include with the log**

- Windows version and display scaling (100%, 125%, 150%, etc.)
- Number of monitors
- Touchpad vs mouse
- Which edge Side Note is docked on (left or right)
- Whether any reminders were scheduled
