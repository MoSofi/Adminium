---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's install check now says what its install will do. `POST /apps/plan` answered `installable: true` for an app whose required add-on this server cannot have, and the install that followed was refused with `ADD_ON_REQUIRED`; the plan now says `installable: false` and names the add-on in `problems` (`ADD_ON_REQUIRED`, or `ADD_ON_DOWNLOAD_REQUIRED` while a catalogue add-on is not downloaded yet). A choice the install makes, such as ticking "Update it too", still leaves the plan installable. In the install wizard, an add-on that cannot be had no longer says which roles will be able to change its settings, a public-access line for people who sign in by a link no longer ends in "by" with nothing after it, and the screen-reader status no longer says "Files unpacked: 0" for an app picked from the shelf or the catalogue. Preferences offers "Workspace default" in the language picker again once a language has been picked, and still says the language is your own when you come back to the page. The home page and the empty sidebar no longer ask you to connect a PostgreSQL database when a database is already connected and has no pages yet, or when pages exist that are not shared with your role; `GET /bootstrap` carries `hasConnections` for this.
