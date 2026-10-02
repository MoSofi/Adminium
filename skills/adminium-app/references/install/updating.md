<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Updating; do not edit -->

# Installing apps: Updating

When a newer version of an installed app is available — already on disk, or offered by the
catalogue — the installed row and the app's own page offer **Update**. It downloads the version
first if it has to, then checks the tables again:

- **The same check, for what is new.** When the new version needs a table the installed one did
  not have, needs a change to an existing table, or finds a name taken, **Update** opens the table
  check before anything runs. A version that needs nothing new applies straight away.
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
  longer declares is revoked. An endpoint the new version would widen is left as it was.
- The app keeps its place: same row, same database connection, same mounts. Older versions of the
  package are removed from disk only after the update succeeds.
