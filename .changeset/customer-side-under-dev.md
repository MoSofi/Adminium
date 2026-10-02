---
'@adminium/server': patch
'@adminium/dashboard': patch
---

A folder app's customer side now works under `adminium dev` with nothing to set. The public API answers the server's own pages unless `ADMINIUM_PUBLIC_API_ORIGINS` says otherwise, and it is switched on (and said in the terminal) when an app's public access is given. A server (`adminium start`) never switches it on: it says what is missing. Studio no longer offers Uninstall for an app whose folder is still in the project, and `adminium app new` points at `npm run dev`.
