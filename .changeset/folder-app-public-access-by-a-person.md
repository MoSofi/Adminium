---
'@adminium/server': minor
'@adminium/dashboard': minor
'@adminium/i18n': minor
---

A person can allow the public access of an app the Designer built, on a server with no `adminium.config.ts` to say so.

A trial (and the hosted installation it becomes) runs as an operator project: its config is built from the environment, so nothing could ever say `apps.<key>.publicAccess`, and a server never gives a folder app public access on its own. An app the Designer built with a customer side therefore opened and could read or save nothing ("This app is not open to customers yet"), and the app's page only said "Update the app and allow it", which an app of the folder cannot do.

- **"Public access" on the app's page.** For an app of the project folder on such a server, the page lists what its customer screens would do, in the words the install check uses, with **Allow this public access**. The list is the server's reading of the installed app. Allowing it makes the app's key and endpoints at once, as ticking the box at an install does, and is audited as the person's. It needs the permission to manage API keys; someone without it reads the list and is told so.
- **Taken back in the same place.** "Take it back" stops the app's key at once and removes its endpoints. Allowing it again makes a new key.
- **More is asked again.** The yes is for the list that was shown, and is refused if the app changed in between. When the Designer later makes the app ask for more (a new entry, a column more on one that is open), the app is applied without the more, customers go on with what was allowed, and the card lists what waits beside what is open. What the app stops asking for is taken off its key at once, with nobody asked.
- **Never by the Designer.** Nothing a model writes gives the access. The Designer is told once that it waits for the person, and where.
- **A project with a config file is as before.** There the committed `adminium.config.ts` decides, the page now says so by name (`apps.<key>.publicAccess`), and `adminium dev` gives the access as the folder declares it.
- The customer page's own message no longer names a setting that may not be there: it sends whoever runs the app to its page under Studio → Apps, which says how to allow it on that server.

New: `GET` and `POST /api/v1/project/apps/{key}/public-access`, and `publicAccess.decides` (`person`, `config` or `dev`) on an app's settings for an app of the folder.
