# Side Note

Dockable desktop sticky notes built with Tauri, React, TypeScript, and SQLite.

## Development

```powershell
npm install
npm run tauri:dev
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
