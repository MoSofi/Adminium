# `build/` — electron-builder inputs (11-electron.md §3, §10)

Owned by 11-T13 / 11-T15.

- `entitlements.mac.plist` — hardened runtime on; **`com.apple.security.cs.allow-unsigned-executable-memory` not granted**; no app sandbox (the app needs arbitrary file access for user-chosen SQLite files, §6).

electron-builder resolves this directory by convention (`buildResources`), which
is why it sits beside `resources/` rather than inside it.
