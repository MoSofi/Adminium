---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A customer's own row ("track my order"), and what a refused call says.

- **Security:** an app that lets anyone add a row to a table and anyone read that table was refused when both were in one `publicAccess` entry, and not when they were written as two entries (`POST` in one, `GET` in the next). Both are refused now, by `adminium app check`, by the Designer and at install, with the claim to use instead. No released app is written that way.
- While an app's folder is worked on (`adminium dev`, the local Designer), a change to what a `publicAccess` entry shows or how it is reached now takes effect when the app is applied. It used to be left as it was, in silence, so a page stayed refused however often `access.json` was rewritten. A server (`adminium start`) and an update of a published app keep what was allowed, as before, and say which entry was left as it was and why.
- A refused `where`, `order` or `q` on a public list (`400` `PUBLIC_QUERY_REFUSED`) names the parameter in `params.parameter` and says what a page does instead.
- Adminium Designer reads its screens' calls before a person meets them (a public list sorted or filtered from the page, a table named by its short name, a claim never made or never read through, a staff filter written as `{ column: value }`), is told the tested recipe for a person's own row when the request is about one, and the preview shows a call Adminium refused with "Ask the Designer to fix it".
- New guide: "Let a customer find their own row" (`guides/apps/manifest-by-task`).
