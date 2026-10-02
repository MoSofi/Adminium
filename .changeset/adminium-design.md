---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

New: `adminium design` opens Adminium Designer in the browser, signed in, on this machine only. Outside a project it makes one first. The server runs in the same process, answers only to `127.0.0.1`, `localhost` and `[::1]` on its port, serves the preview of what is built on `localhost` (a different site, so the preview's code cannot act for the person), names its session cookie for its port, and signs in the owner it made with a one-use link carried after `#`. The owner has no password until `adminium owner set` gives one; `start` says so. The plain `npx @adminiumjs/adminium` flow now asks what to start with: describe an app, connect a database, or sample data. New permission `system:designer:use` (Super Admin only by default).
