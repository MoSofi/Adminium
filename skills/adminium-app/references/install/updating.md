<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Updating; do not edit -->

# Installing apps: Updating

When a newer version of an installed app is available — already on disk, or offered by the
catalogue — the installed row and the app's own page offer **Update**. It downloads the version
first if it has to, then checks the tables again:

- **The same check, for what is new.** When the new version needs a table the installed one did
  not have, needs a change to an existing table, or finds a name taken, **Update** opens the table
  check before anything runs. A version that needs nothing new applies straight away.
- **A newer add-on comes along when you say so.** When the new version needs a newer version of an
  add-on it works with, the check lists it on the **Add-ons** card with **Update it too** ticked:
  that copy of the add-on is updated with the app. Unticked, **Update** waits. Through the API,
  send `"addOns": [{ "key": "…", "version": "…", "update": true }]`. When the add-on also runs on
  another database (another app's copy, on an older version), the check says so instead: every
  copy runs one version, so update every copy on the Add-ons page first, then the app.
- **Unique rules as a fresh install has them.** A column the app keeps unique that the table lets
  repeat is given its rule by the update. If rows already repeat a value there, the check names
  the column and nothing runs until they differ.
- **The table names stay.** An update uses the database and the table names the install already
  has. It never offers a different prefix; moving an app to other names is an uninstall and an
  install.
- **A refused update says why.** When the new version cannot be applied to this database, the
  message lists each reason, and the installed version keeps running untouched.
- **Pages follow the version, except yours.** New pages are added and untouched ones rebuilt. A
  page someone edited is left exactly as it is.
- **Public access follows the version, with your say.** When the new version adds to what the
  app's customers can do, or turns a staff screen's key into one a shared link opens, the check
  shows it on the **Allow this public access** card, and it is given only if you tick it. Through
  the API, send `"publicAccess": true` with the update; without it nothing new is given. What the
  version no longer declares is taken back from the app's keys on every update, and a key it no
  longer declares is revoked.
- **Endpoints that would show visitors more are shown first.** When the new version changes a
  public endpoint the app's key already uses so that visitors would see or do more (a new column,
  a new method, a filter loosened), the check lists each one on the **Shows visitors more** card,
  the app's own and those of an add-on it updates or serves, and **Update** waits until you tick
  **Allow it**. Only someone who may manage API keys can allow it. Through the API, send
  `"publicWider": true` with the update; without it the update is refused with `PUBLIC_WIDER` and
  nothing runs. Each widening is written to the audit log (`public-endpoint.widen`). An endpoint
  the new version narrows, or does not change, is saved without a question.
- **Roles that get more of an add-on's tables are shown first.** When the new version's roles
  would read or change more of an add-on's tables than the running version's (a new action, a new
  column, or every column where before it was some), the check lists what is new, and pressing
  **Update** allows it. Through the API, send `"roleTables": true` with the update; without it the
  update is refused with `ROLE_TABLES_WIDER` and nothing runs. The same holds when an add-on's new
  version gives the roles more (its `appGrants` widened): an update of the add-on itself, or an
  app's install or update that brings it along, lists each app's role that gets more, and is
  refused without `"roleTables": true`.
- The app keeps its place: same row, same database connection, same mounts. Older versions of the
  package are removed from disk only after the update succeeds, and only when no copy runs them.
- **Every copy moves together.** An app installed on several databases has one **Update every
  copy**: each copy is updated in turn, through its own check. See
  [One version for every copy](https://docs.adminium.dev/self-hosting/apps-per-database/#one-version-for-every-copy).
- **An update that stops part way is finished, not undone.** The copy's row says where it stopped,
  and **Finish the update** runs it again from there, even after a reload.

Uploading a file of an installed app routes it: a newer file offers **Update every copy**, the same
version offers **Install on another database**, and an older one is refused, naming each database's
version.
