---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Studio → Server settings → Export everything: a Super Admin downloads one file with everything made in the installation (pages, people without their passwords, uploads, local SQLite databases, the project folder), the same file as `adminium archive create --export`. The server makes it with a progress percent, keeps it for one download by the same session within 10 minutes, makes one at a time, and deletes leftovers at boot. New routes `POST /api/v1/export/zip`, `GET /api/v1/export/zip` and `GET /api/v1/export/zip/:id`. `adminium import-zip <file>` now takes the file on its own, and on an export file gives one Super Admin a new password (asked twice, or `--password-stdin`; `--owner` picks who), so the imported instance can be signed in to without mail.
