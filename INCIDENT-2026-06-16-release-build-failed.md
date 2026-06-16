# Incident: Release Build Served Dev Server Instead of Built Assets

**Date:** 2026-06-16
**Severity:** Medium
**Status:** Resolved

## Summary

After modifying Rust code and rebuilding with `cargo build --release`, running `cargo run --release` displayed "localhost refused to connect" instead of the app UI.

## Root Cause

- `cargo run --release` launches the Tauri app in **standalone mode** — it does NOT automatically start the Vite dev server (`npm run dev`)
- The app's `tauri.conf.json` is configured with:
  - `beforeDevCommand: "npm run dev"` — runs dev server before `tauri dev`
  - `beforeBuildCommand: "npm run build"` — builds frontend before `tauri build`
- In **release mode**, the app loads pre-built frontend assets from `dist/`
- Since `npm run build` had not been run after the code changes, `dist/` was stale or missing

## Symptom

- App window opened but showed browser error: "localhost refused to connect"
- Vite dev server was not running (as expected in release mode)

## Resolution

1. Built frontend: `npm run build` → generates `dist/` folder
2. Restarted app: `cargo run --release`
3. App loaded correctly with built assets

## Lessons Learned

| Rule | Description |
|------|-------------|
| **Dev vs Release** | `cargo run --dev` starts dev server automatically; `cargo run --release` requires manual `npm run build` first |
| **Always build frontend before release** | After any frontend or Rust changes, run `npm run build` before `cargo run --release` |
| **Recommended workflow** | Use `npm run tauri dev` for development (auto-rebuilds) or explicitly `npm run build && cargo run --release` for release testing |

## Correct Build Sequence

```bash
# Option 1: Development (auto rebuilds)
npm run tauri dev

# Option 2: Release test
npm run build          # Build frontend first
cargo run --release    # Then launch app
```
