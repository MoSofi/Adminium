# `build/` — electron-builder inputs


- `entitlements.mac.plist` — hardened runtime on; **`com.apple.security.cs.allow-unsigned-executable-memory` not
  granted**; no app sandbox (the app needs arbitrary file access for user-chosen SQLite files).

electron-builder resolves this directory by convention (`buildResources`), which
is why it sits beside `resources/` rather than inside it.
