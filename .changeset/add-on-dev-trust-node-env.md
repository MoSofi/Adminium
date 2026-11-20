---
'@adminium/server': patch
---

`ADMINIUM_ADD_ON_DEV_TRUST` now works only on a server whose `NODE_ENV` is `test` or `development`. With it set and `NODE_ENV` unset or any other value, the server refuses to start and says to set `NODE_ENV=development`: an npm install run as a service and the desktop app set no `NODE_ENV`, and a copy left in an env file could otherwise run add-on code no catalogue vouched for. With `NODE_ENV=production` it stays ignored, and the log now says so at every start. `adminium app try` trusts the packages it tries for its own run, as before. `adminium start` also refuses `ADMINIUM_LEAD_SOURCE_DEMO` outside a test or development server now, as the boot already did elsewhere.
