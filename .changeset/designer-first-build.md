---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

Adminium Designer: a first build worth keeping. An app's own screens now start with a look: made parts (a header with the business's name, cards, a form, buttons, an empty state; a list and a board for staff) in `src/app.css`, drawn from `src/theme.css`, in one of four directions (clean, warm, bold, calm), light and dark. The first time a side is added the Designer asks how it should look (four directions, "Surprise me", or your own words) unless the request already said; the choice is kept in the app's `look.json`. "Change the look" under the last turn switches direction with no model call and saves a version. The Designer gives the app a short name of its own, the session's title follows it, and a screen's header follows a rename at the next build (`APP_NAME` from `@adminiumjs/adminium/side`). It writes a few sample rows for what customers read, and sample rows written after the first apply are now added when the app first names them. A project made by `adminium design` starts with React and the public client, so a first build shows no package card; elsewhere the screens' packages are asked for on one card. A file refused as invalid JSON shows the lines around the fault and what is still open there, and says so when the same text is sent again. The preview no longer says a side "did not build" after a later build fixed it. A failed turn shows the model provider's own reason when it gave one. `adminium app new --sides` and `adminium app add-side` write the same starter.

The check of an app's public access says where a guest quantity's `validation` goes (on the column) and what to do when `expect` names a figure Adminium does not work out.
