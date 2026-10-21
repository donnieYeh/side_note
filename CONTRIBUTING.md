# Contributing

Thanks for helping improve Side Note. Bug reports, feature requests, documentation updates, and focused pull requests are welcome.

## Before you start

- Open an issue before making a large change so the proposed direction can be discussed.
- Keep pull requests focused and describe the user problem they address.
- Do not include personal notes, SQLite databases, logs, or built executables.

## Development setup

Side Note currently builds for Windows x64. Install Node.js LTS, Rust stable with the MSVC toolchain, Microsoft C++ Build Tools, and WebView2. The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) page has setup details.

```powershell
npm ci
npm run tauri:dev
```

Use `npm run dev:stop` to stop this project's development processes.

## Pull requests

- Explain what changed and how to reproduce or review it.
- For interface changes, include a screenshot in the pull request description.
- Run `npm run build` or `npm run tauri:build` when your changes affect the build, and report the result.
- Update the README or other documentation when commands, behavior, or supported platforms change.
- If you have not run the app manually, say so in the pull request description.

## Bug reports

Include the Side Note version, Windows version, display scaling, monitor count, mouse or touchpad, dock side, and steps to reproduce. Attach relevant log excerpts only after checking them for personal information.
