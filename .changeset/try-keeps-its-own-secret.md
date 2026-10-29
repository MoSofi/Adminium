---
'@adminium/server': patch
'@adminium/docs': patch
---

`npx @adminiumjs/adminium try` no longer stops at once asking for `ADMINIUM_SECRET`. With none set, it makes one for a new data folder and keeps it in `<data dir>/secret`, readable by you only, and says where. `adminium start` and the other commands read it back from the same folder, and `new --import` copies it into the project's `.env`. A secret in the environment always wins. A folder that already holds an instance never gets a new one, since that would leave its stored connection strings unreadable: `try` asks you to set the secret the instance was made with. The quickstart and the environment variables page say so.
