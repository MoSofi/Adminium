# @adminium/dashboard

## 0.3.0

### Patch Changes

- d3a8058: **An app's own roles can see personal data where their work needs it, and an edit can be limited to some columns.**
  
  Personal columns (a patient's mobile, email, address, an allergy note) used to be shown in clear
  only to people who manage database connections, so an app's staff roles read them as empty and a
  clinic's reception could not ring anyone. A new table permission, `read_pii`, shows one table's
  personal columns: an app grants it as `table:@patients:read_pii`, and **People → Roles &
  permissions** has a **See personal data in records** row that grants it on every table. The table
  asked about is the one the value lives in, so a lookup from appointments to a patient's mobile
  needs it on patients. It applies to lists, single records, lookups, measures, dashboard cards,
  record pages and exports. A `*` action never includes it, so no existing role gains it. Live
  updates stay masked for everyone, and the public API is unchanged.
  
  An app role can limit what its edit permission on a table may change: `limits` on the role, per
  table, with `writable` columns and `writableValues`, the names public access uses. A clinician
  may move a visit from roomed to ready and nothing else; anything outside the limit is refused
  `403` `COLUMN_FORBIDDEN`, naming the column and the value. It covers editing one record, many at
  once, and rows edited from another record's form. Someone who also holds a role with an
  unlimited edit on the table, an Admin or Super Admin, is not limited. Saving the role in the
  permissions matrix keeps its limits, and an app update writes the new version's.
- d3a8058: **Calendar pages plot by the right columns and open the page's own form; a few app fixes.**
  
  - A calendar opens on the month today falls in, and its day list on today. It used to open on a
    fixed month from the demo data, or on the month most rows were in.
  - An app can name a calendar's columns in its page's `config.calendar` (`start`, `end`, `title`,
    which may read through a foreign key such as `patient_id.name`, and `category`). Without it, a
    table with a booking rule is plotted by the booking's start instead of the first date in the
    table. On a page with a form, **Add event** and a click on an empty day open that form, with the
    day filled in.
  - KPI cards on calendar, scheduler, board, queue, log and directory pages read money in the
    connection's currency, as dashboard cards already did.
  - A link table with its own `id` and two foreign keys counts as a link between the two tables, so
    a chips field over it ("Visit types they do") reads and saves its rows. A form field may name
    the link table. A designed field that cannot be shown now says so in the form, and the install
    report and the server log name a field the install could not bind.
  - A create replies with the row as stored, its totals and balance included. It used to reply
    before they were added up, so a new visit showed no balance.
  - An app's email with no address on the row goes to the person the row links (or a first visit's
    own address), and the address is written into the row. A recipient whose language is not one of
    Adminium's gets the nearest template, with dates and times written their own way: `en-GB`
    reads "09:30".
- 64a1f12: **Columns Adminium fills in: stamps, balances, unique values and relative filters.**
  
  - A **stamp** writes the time, or who did it, when a row is made or a column changes to a value
    ("checked in at", "cancelled by"); a guest's write can stamp something else than the staff's.
  - A total can count only some child rows (`where`) and keep a **balance** (a fee less payments and
    write-offs). With **`cap`**, a change that would take a balance below zero is refused with
    `BALANCE_EXCEEDED`; a payment taken while another is being written waits for it.
  - A column can be **unique**, enforced by the database under the real table's name.
  - Public endpoints can filter on the venue's **today** or the days from today, allow a column only
    certain values, and change a row only while it is in a given state or still ahead.
  
  Studio's column inspector shows each of these rules.
- d3a8058: The Roles & permissions editor's messages leave the eagerly bundled `common`
  catalogue for a deferred `roles` namespace, which `/settings/roles` loads
  before it renders.
  
  `common` ships in every user's first load, so its 76 `roles.*` keys were paid
  for on every route by every user, for one lazy admin screen behind a permission
  the built-in Admin does not hold. Moving them is what makes room for the new
  strings in this release without raising the entry-chunk budget.
  
  **Operators with customised translations:** meta migration `0043` re-files
  overrides written against the old `common:roles.*` addresses under `roles:`.
  Every key moved, so nothing is copied or left behind.
- 64a1f12: **An app can have a second key for a kiosk, bound to a signed-in staff member.**
  
  A kiosk's key is served only to the screen of a staff member holding the app's kiosk role (a
  screens-only role with no data), and answers only beside that sign-in, from the same page, with
  its CSRF token on writes, and on the app's own staff host when one is mapped. The app switches it
  off from its settings row (`PUBLIC_KEY_OFF`); it stops with the staff side. Sessions found at a
  kiosk last three minutes, ask no proof of work, and count per screen. An app update rebinds it,
  revokes it when the app drops it, and never re-makes one an operator revoked. The API keys page
  marks it "Staff screen only".
  
  Also fixed: a staff member signed in on the same browser no longer breaks an app's public pages
  (the public API's requests are the key's, not the cookie's), and a screens-only person may call the
  public API.
  
  An app's staff screens also learn what the signed-in person may do: the staff config carries
  `access`, their read / create / update / delete on each of the app's tables and the app's roles
  they hold, so a screen can leave out a button whose write the server would refuse.
  
  A check-in can wait for its time: `writableWhen` takes a window on a time,
  `{starts_at: {within: 60}}`, meaning no more than 60 minutes ahead (a late arrival always
  passes). An earlier change is refused `409` `PUBLIC_TOO_EARLY` with the row's time and when the
  window opens (`params.at`, `params.from`), and only when the row is the caller's own and nothing
  but the window stood in the way; every other miss is still `404`. The public client reads them as
  `error.tooEarly`.
- 64a1f12: **Dashboard cards speak the page's language and lead somewhere.**
  
  - A KPI card with a link is one button that opens it; nine new icons for front-desk cards.
  - A chart grouped by a link names each group by the row it points at ("Dr Rao", not 7), under
    your read and masking; a choice column's groups and record-list cells use its labels.
  - Money cards use the connection's currency unless they name their own.
  - A dashboard can end its day controls with one link ("Open the desk").
  - Card titles can carry translations, picked by the page's language.
  - A choice column's value labels an app ships in several languages are read in each person's own:
    a status pill, a chart legend and a form's choices say "Wartend" to a German reader and
    "Waiting" to an English one. A card that lists its own columns takes them from the answer too.
    Labels installed before stay as they were until the app is updated. A page's list, record,
    master-detail, queue and calendar say them too, as do the words of an inline list of allowed
    values in the form, the filters and the list; a page that names its own words keeps them.
- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **Studio → API keys & tokens is rebuilt around endpoints.**
  
  `/studio/public-api` now shows:
  
  - your keys, marked browser or server. Each key lists what it can call. A browser key can be
    revealed, and a key can be revoked after typing its name to confirm.
  - the endpoints generated from your schema, with their methods, auth and rate limit.
  - a quick-start `curl`.
  - the number of requests in the last 24 hours.
  
  "Create key" opens a sheet where you pick endpoints and, under each one, the methods the key may
  use:
  
  - select all, deselect all, or a read-only preset, applied to the endpoints the filter shows;
  - two layouts, which the browser remembers.
  
  The new key is shown once in a banner.
  
  "New endpoint" and "Edit endpoint" open a builder whose form and JSON definition edit the same
  document. A key you add by hand in the JSON is never dropped by a form change. While the JSON has
  unapplied edits, the form is locked and Save waits. A save that would break a live key says which
  key.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.
- ab31a89: **Apps can ship sample data you add and remove in one step.**
  
  An app that ships sample data offers it on its settings page (and, unticked, when you install
  it). Adding works after your own records: a code or sequence number your table already holds is
  left for the app's own rules to fill. While it is loaded, the app's pages say so. Removing it
  lists the sample rows you changed or that other records use and keeps them by default — kept
  rows become yours — and removes the rest; afterwards you can add it again. Images go to the
  Files library.
- ab31a89: **Each installed app has its own settings page, sidebar section and place in the command palette.**
  
  **Studio → Hosted apps → <app>** shows the app's sets of screens — staff and customer, each
  switched on or off, and whether the staff screens live inside the dashboard or on their own
  address — with their addresses and domains; its business type; and **Disable**, **Update** and
  **Uninstall**. Disabling hides the app everywhere and stops its endpoints without deleting
  anything. Extra instances — the same app on another database, at `/apps/<key>/<slug>/staff/` —
  are set on **Hosted apps**.
  
  The app's pages sit in its own sidebar section under its name and version. The command palette
  finds the app's pages and its staff screens — also those of an app that opens on its own
  address, and each extra instance — and opens them where they live.
  
  A customer domain serves only the app's own pages and `/api/v1/public/*`. A browser that asks it
  for anything else gets a plain "Page not found" page in the reader's language (API calls keep
  the JSON envelope); a switched-off side gets "not available" (503); someone signed in without
  access to the staff screens gets "This account can't open <app>" with a sign-out.
- ab31a89: **Installing an app checks every table first, and never writes anything you have not seen.**
  
  Before **Install**, the new **Check the tables** step lists each table the app needs: **New**,
  **Yours from an earlier install**, **Shared with another app** or **Name taken**. For a taken
  name you choose: use the table as it is (offered only when it is safe — a table with a required
  column the app never fills cannot be reused, and the page says why), rename the existing table
  out of the way (Adminium repairs its own pages, grants, label overrides and public endpoints
  that named it), or give the whole app a different prefix. Apps that ask for it get their tables
  under their own prefix (`pos_menu_items`), so another app's plain `payments` is never in the way.
  
  An install that stops part way answers `409 APP_INSTALL_INCOMPLETE` naming the stage and the
  tables already made; nothing is removed, and **Try again** finishes from where it stopped.
  Updating runs the same check for new tables and keeps the names an install already has; an
  update that cannot run lists every reason. An install made before its app used a prefix is
  offered **Rename to <prefix>…**, which previews every table and then renames them, with pages,
  grants, overrides and endpoints following.
  
  Uninstalling keeps your data unless a Super Admin ticks **Also delete its tables and data** and
  types the app's key; only tables the app created and no other app uses are dropped. Pages you
  edited stay as ordinary pages, the app's key is revoked at once, and a domain that pointed at the
  app answers `503 SURFACE_UNAVAILABLE` until you map it again. A reinstall recognises the tables
  it left.
- ae41762: **Deleting a connection or a public scope that ever had a publishable key works now.**
  
  A connection's public scopes cascade away with it, but a publishable key is
  `restrict` on its scope (0014), so the cascade hit the key and the driver
  error came back as an unhandled 500 — on every meta dialect, not only
  Postgres. The test that claimed "deleting the connection clears both" deleted
  the keys by hand first, so it never ran the real path.
  
  The delete now looks at the keys first, in one transaction with the delete:
  
  - A **live** key (not revoked, not expired) refuses the whole delete with a
    `409 PUBLIC_KEYS_LIVE` whose `details.keys` names each key. The migration's
    rule stands: the operator revokes a shipped public surface on purpose, and
    sees what it breaks. It is not a side effect of deleting something else. The
    delete dialog names the keys and points at the Public API page. It no longer
    says "Try again".
  - **Revoked or expired** keys break nothing, and nothing else in the product
    can remove their rows, so they are cleared with the connection. Their
    sessions and challenges cascade with them. The `connection.delete` audit row
    lists each cleared key's id and prefix. Their `public-key.revoke` rows are
    unchanged.
  
  Deleting a **scope** had the same dead end in a different form. It refused
  while any key row pointed at it, revoked or not. Nothing in the product
  removes a key row, so a scope that ever had a key could never be deleted, and
  the refusal told the operator to revoke, which did not help. It now follows
  the same rule through the same helper: live keys refuse with
  `PUBLIC_KEYS_LIVE`, and inert ones go with the scope, named in the
  `public-scope.delete` audit row. The Public API page names the blocking keys,
  and its delete dialog no longer says "Keys are not deleted".
  
  The FK stays `restrict`, and no migration was needed. The connection's pool is
  now released after the row is gone, so a refused delete keeps its pool.
- ab31a89: **"Keep me signed in" now does what it says.**
  
  The box on the sign-in page, and **Keep me signed in on this tablet** on an app's
  staff address, was collected and never sent: every sign-in got the same 30-day
  cookie whatever it said. The box now starts ticked, as the designs draw it.
  Ticked, the session survives closing the browser, as before. Unticked, the
  session cookie has no `Max-Age`, so the browser drops it when it closes.
  
  `POST /api/v1/auth/login` takes an optional `remember` boolean. `false` gives
  the browser-session cookie; `true` or leaving it out gives the long-lived
  cookie, so API clients that never send it are unaffected. The answer is given
  once: a two-factor sign-in carries it through `/auth/2fa/verify`, and changing
  your password keeps it, so an unticked sign-in on a shared computer is never
  turned into a 30-day one.
  
  Only the cookie changes. The session still ends after 7 days without use or at
  the workspace's session limit either way, and a browser that restores its last
  tabs may bring back an unticked session too.
  
  Meta migration `0041_session_persistent` adds `adminium_sessions.persistent`
  (default true, so every existing session stays long-lived).
- ab31a89: **App manifests can name their tables and columns in every language, and dashboards gain a day control.**
  
  A manifest's tables take `label`, `labelPlural` and `keyField`, its columns a `label`, and enum
  columns a label per value — plain text or a map keyed by language. Forms, grids, filters and
  dashboard cards use them, in the viewer's language.
  
  A dashboard page can show **Today / Yesterday / This week / Pick a day**; every card reads the
  chosen day on the venue's clock, and hourly bars are labelled by hour. `SegmentedControl` takes
  an `itemClassName`.
  
  Fixes: SQLite boolean updates, a SQLite `now` default on the server's wall clock, SQLite schema
  edits after another program changed the database, a public key's scope refreshing when the
  connection's time zone or currency changes, and a revoked key no longer answering after an
  uninstall.
- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- Updated dependencies [64a1f12]
- Updated dependencies [d3a8058]
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [d3a8058]
- Updated dependencies [64a1f12]
- Updated dependencies [64a1f12]
- Updated dependencies [64a1f12]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [c451e7d]
- Updated dependencies [ae41762]
  - @adminium/i18n@0.3.0
  - @adminium/ui@0.3.0
  - @adminium/engine@0.3.0
  - @adminium/widgets@0.3.0
  - @adminium/tokens@0.3.0
  - @adminium/charts@0.3.0
  - @adminium/add-on-contracts@0.3.0

## 0.3.0-rc.4

### Patch Changes

- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.
- ab31a89: **Apps can ship sample data you add and remove in one step.**
  
  An app that ships sample data offers it on its settings page (and, unticked, when you install
  it). Adding works after your own records: a code or sequence number your table already holds is
  left for the app's own rules to fill. While it is loaded, the app's pages say so. Removing it
  lists the sample rows you changed or that other records use and keeps them by default — kept
  rows become yours — and removes the rest; afterwards you can add it again. Images go to the
  Files library.
- ab31a89: **Each installed app has its own settings page, sidebar section and place in the command palette.**
  
  **Studio → Hosted apps → <app>** shows the app's sets of screens — staff and customer, each
  switched on or off, and whether the staff screens live inside the dashboard or on their own
  address — with their addresses and domains; its business type; and **Disable**, **Update** and
  **Uninstall**. Disabling hides the app everywhere and stops its endpoints without deleting
  anything. Extra instances — the same app on another database, at `/apps/<key>/<slug>/staff/` —
  are set on **Hosted apps**.
  
  The app's pages sit in its own sidebar section under its name and version. The command palette
  finds the app's pages and its staff screens — also those of an app that opens on its own
  address, and each extra instance — and opens them where they live.
  
  A customer domain serves only the app's own pages and `/api/v1/public/*`. A browser that asks it
  for anything else gets a plain "Page not found" page in the reader's language (API calls keep
  the JSON envelope); a switched-off side gets "not available" (503); someone signed in without
  access to the staff screens gets "This account can't open <app>" with a sign-out.
- ab31a89: **Installing an app checks every table first, and never writes anything you have not seen.**
  
  Before **Install**, the new **Check the tables** step lists each table the app needs: **New**,
  **Yours from an earlier install**, **Shared with another app** or **Name taken**. For a taken
  name you choose: use the table as it is (offered only when it is safe — a table with a required
  column the app never fills cannot be reused, and the page says why), rename the existing table
  out of the way (Adminium repairs its own pages, grants, label overrides and public endpoints
  that named it), or give the whole app a different prefix. Apps that ask for it get their tables
  under their own prefix (`pos_menu_items`), so another app's plain `payments` is never in the way.
  
  An install that stops part way answers `409 APP_INSTALL_INCOMPLETE` naming the stage and the
  tables already made; nothing is removed, and **Try again** finishes from where it stopped.
  Updating runs the same check for new tables and keeps the names an install already has; an
  update that cannot run lists every reason. An install made before its app used a prefix is
  offered **Rename to <prefix>…**, which previews every table and then renames them, with pages,
  grants, overrides and endpoints following.
  
  Uninstalling keeps your data unless a Super Admin ticks **Also delete its tables and data** and
  types the app's key; only tables the app created and no other app uses are dropped. Pages you
  edited stay as ordinary pages, the app's key is revoked at once, and a domain that pointed at the
  app answers `503 SURFACE_UNAVAILABLE` until you map it again. A reinstall recognises the tables
  it left.
- ab31a89: **"Keep me signed in" now does what it says.**
  
  The box on the sign-in page, and **Keep me signed in on this tablet** on an app's
  staff address, was collected and never sent: every sign-in got the same 30-day
  cookie whatever it said. The box now starts ticked, as the designs draw it.
  Ticked, the session survives closing the browser, as before. Unticked, the
  session cookie has no `Max-Age`, so the browser drops it when it closes.
  
  `POST /api/v1/auth/login` takes an optional `remember` boolean. `false` gives
  the browser-session cookie; `true` or leaving it out gives the long-lived
  cookie, so API clients that never send it are unaffected. The answer is given
  once: a two-factor sign-in carries it through `/auth/2fa/verify`, and changing
  your password keeps it, so an unticked sign-in on a shared computer is never
  turned into a 30-day one.
  
  Only the cookie changes. The session still ends after 7 days without use or at
  the workspace's session limit either way, and a browser that restores its last
  tabs may bring back an unticked session too.
  
  Meta migration `0041_session_persistent` adds `adminium_sessions.persistent`
  (default true, so every existing session stays long-lived).
- ab31a89: **App manifests can name their tables and columns in every language, and dashboards gain a day control.**
  
  A manifest's tables take `label`, `labelPlural` and `keyField`, its columns a `label`, and enum
  columns a label per value — plain text or a map keyed by language. Forms, grids, filters and
  dashboard cards use them, in the viewer's language.
  
  A dashboard page can show **Today / Yesterday / This week / Pick a day**; every card reads the
  chosen day on the venue's clock, and hourly bars are labelled by hour. `SegmentedControl` takes
  an `itemClassName`.
  
  Fixes: SQLite boolean updates, a SQLite `now` default on the server's wall clock, SQLite schema
  edits after another program changed the database, a public key's scope refreshing when the
  connection's time zone or currency changes, and a revoked key no longer answering after an
  uninstall.
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
- Updated dependencies [a795485]
- Updated dependencies [ab31a89]
- Updated dependencies [ab31a89]
  - @adminium/i18n@0.3.0-rc.4
  - @adminium/ui@0.3.0-rc.4
  - @adminium/engine@0.3.0-rc.4
  - @adminium/widgets@0.3.0-rc.4
  - @adminium/charts@0.3.0-rc.4
  - @adminium/add-on-contracts@0.3.0-rc.4
  - @adminium/tokens@0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **Studio → API keys & tokens is rebuilt around endpoints.**
  
  `/studio/public-api` now shows:
  
  - your keys, marked browser or server. Each key lists what it can call. A browser key can be
    revealed, and a key can be revoked after typing its name to confirm.
  - the endpoints generated from your schema, with their methods, auth and rate limit.
  - a quick-start `curl`.
  - the number of requests in the last 24 hours.
  
  "Create key" opens a sheet where you pick endpoints and, under each one, the methods the key may
  use:
  
  - select all, deselect all, or a read-only preset, applied to the endpoints the filter shows;
  - two layouts, which the browser remembers.
  
  The new key is shown once in a banner.
  
  "New endpoint" and "Edit endpoint" open a builder whose form and JSON definition edit the same
  document. A key you add by hand in the JSON is never dropped by a form change. While the JSON has
  unapplied edits, the form is locked and Save waits. A save that would break a live key says which
  key.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- ae41762: **Deleting a connection or a public scope that ever had a publishable key works now.**
  
  A connection's public scopes cascade away with it, but a publishable key is
  `restrict` on its scope (0014), so the cascade hit the key and the driver
  error came back as an unhandled 500 — on every meta dialect, not only
  Postgres. The test that claimed "deleting the connection clears both" deleted
  the keys by hand first, so it never ran the real path.
  
  The delete now looks at the keys first, in one transaction with the delete:
  
  - A **live** key (not revoked, not expired) refuses the whole delete with a
    `409 PUBLIC_KEYS_LIVE` whose `details.keys` names each key. The migration's
    rule stands: the operator revokes a shipped public surface on purpose, and
    sees what it breaks. It is not a side effect of deleting something else. The
    delete dialog names the keys and points at the Public API page. It no longer
    says "Try again".
  - **Revoked or expired** keys break nothing, and nothing else in the product
    can remove their rows, so they are cleared with the connection. Their
    sessions and challenges cascade with them. The `connection.delete` audit row
    lists each cleared key's id and prefix. Their `public-key.revoke` rows are
    unchanged.
  
  Deleting a **scope** had the same dead end in a different form. It refused
  while any key row pointed at it, revoked or not. Nothing in the product
  removes a key row, so a scope that ever had a key could never be deleted, and
  the refusal told the operator to revoke, which did not help. It now follows
  the same rule through the same helper: live keys refuse with
  `PUBLIC_KEYS_LIVE`, and inert ones go with the scope, named in the
  `public-scope.delete` audit row. The Public API page names the blocking keys,
  and its delete dialog no longer says "Keys are not deleted".
  
  The FK stays `restrict`, and no migration was needed. The connection's pool is
  now released after the row is gone, so a refused delete keeps its pool.
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
- Updated dependencies [ae41762]
  - @adminium/i18n@0.3.0-rc.3
  - @adminium/tokens@0.3.0-rc.3
  - @adminium/ui@0.3.0-rc.3
  - @adminium/charts@0.3.0-rc.3
  - @adminium/widgets@0.3.0-rc.3
  - @adminium/engine@0.3.0-rc.3
  - @adminium/add-on-contracts@0.3.0-rc.3

## 0.3.0-rc.2

### Patch Changes

- @adminium/add-on-contracts@0.3.0-rc.2
  - @adminium/charts@0.3.0-rc.2
  - @adminium/engine@0.3.0-rc.2
  - @adminium/i18n@0.3.0-rc.2
  - @adminium/tokens@0.3.0-rc.2
  - @adminium/ui@0.3.0-rc.2
  - @adminium/widgets@0.3.0-rc.2

## 0.3.0-rc.1

### Patch Changes

- @adminium/add-on-contracts@0.3.0-rc.1
  - @adminium/charts@0.3.0-rc.1
  - @adminium/engine@0.3.0-rc.1
  - @adminium/i18n@0.3.0-rc.1
  - @adminium/tokens@0.3.0-rc.1
  - @adminium/ui@0.3.0-rc.1
  - @adminium/widgets@0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- Updated dependencies [c451e7d]
  - @adminium/i18n@0.3.0-rc.0
  - @adminium/charts@0.3.0-rc.0
  - @adminium/widgets@0.3.0-rc.0
  - @adminium/engine@0.3.0-rc.0
  - @adminium/add-on-contracts@0.3.0-rc.0
  - @adminium/tokens@0.3.0-rc.0
  - @adminium/ui@0.3.0-rc.0

## 0.2.9

### Patch Changes

- ad014d7: **Add-ons download from downloads.adminium.dev instead of the npm registry.**
  With browsing online switched on, the catalog comes from
  `https://adminium.dev/marketplace/v2/catalog.json`, and each add-on from
  `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`. The server
  builds that address itself from the catalog's key and exact version, and the
  downloaded bytes must still match the sha512 the release recorded before
  anything is unpacked. `registry.npmjs.org` is no longer contacted. Browsing
  online stays off by default, and `ADMINIUM_NETWORK_FEATURES=off` and the
  desktop app's air-gap mode still veto it.
  
  After upgrading, refresh the catalog once. A catalog cached by an earlier
  version is in the old format, so until the refresh the Add-ons page lists only
  what is already on disk, and a download asks for the refresh.
  
  The bundled add-ons in the Docker image and the desktop app are fetched from
  the same host when they are built, against the same pinned hashes.
  
  The sideload card and the app upload step now point to the sha512 fingerprint
  published with each release, instead of `npm pack --json`.
  
  If you filter the audit log: a finished download records `source: 'download'`
  (it was `'npm'`), a download whose bytes do not match is recorded as
  `add-on.verify-refused` (the same action as a refused upload), and download
  failures carry the reasons `TARBALL_NOT_FOUND` and `DOWNLOAD_ADDRESS_MISMATCH`.
  `PACKUMENT_UNREACHABLE`, `VERSION_NOT_PUBLISHED`, `LEDGER_MISMATCH` and
  `FOREIGN_TARBALL_HOST` no longer occur.
- 962671c: **Hosted apps can browse, download and update from the online app catalogue.**
  *Studio → Hosted apps* now lists released apps beside the ones your build
  shipped and the ones you uploaded. Installing one downloads it from
  `https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz`, checks the
  bytes against the fingerprint the release recorded, unpacks it under the same
  hardened limits as an upload, and then opens the usual install wizard — nothing
  is created in your database until you confirm the schema plan.
  
  Browsing online is **its own switch**, `apps.catalogEnabled`, separate from the
  add-on one and **off by default**: a deployment may want apps listed online and
  add-ons not, or the reverse. `ADMINIUM_NETWORK_FEATURES=off` and the desktop
  app's air-gap mode veto it exactly as they veto the add-on catalogue, and with
  it off nothing from a cached list is offered at all. Browsing stays a disk read;
  **Check for newer** is the separate, explicit action that fetches
  `https://adminium.dev/marketplace/v2/apps.json`.
  
  **Installed apps can be updated.** A newer version — already on disk, or offered
  by the catalogue — puts Update on the app's row. New tables are shown to you as
  DDL before they are created, in the database the app already uses; a table that
  exists but is missing columns the new version needs refuses the update and names
  them; nothing is altered or dropped. The app keeps its row, its connection and
  its mounts, and older versions are removed from disk only after the update
  succeeds.
  
  Every released app declares the oldest Adminium it runs on. A release that needs
  a newer one is listed with the version it needs and cannot be installed, rather
  than being hidden.
  
  New endpoints, all behind `manifests.manage`: `PUT /api/v1/apps/catalog`,
  `POST /api/v1/apps/catalog/refresh`, `POST /api/v1/apps/download` and
  `POST /api/v1/apps/{key}/update`. `GET /api/v1/apps/catalog` keeps its shape and
  gains `source`, `state`, `updateTo`, `updateStaged` and `needsNewerAdminium` per
  row, plus `onlineEnabled` and `catalogFetchedAt`. Audit actions:
  `app.catalog-toggled`, `app.catalog-refreshed`, `app.catalog-refresh-failed`,
  `app.staged` (with `source: 'download'`), `app.verify-refused`,
  `app.download-failed` and `app.updated`.
- Updated dependencies [ad014d7]
- Updated dependencies [962671c]
  - @adminium/i18n@0.2.9
  - @adminium/charts@0.2.9
  - @adminium/widgets@0.2.9
  - @adminium/engine@0.2.9
  - @adminium/tokens@0.2.9
  - @adminium/ui@0.2.9

## 0.2.8

### Patch Changes

- 3d627e5: **Uploading an add-on asks only for the file and its hash.** The "Upload a
  package" card on Studio → Add-ons used to ask for the add-on key and version as
  well. The server staged the package under whatever was typed, and nothing
  checked the typed key against the manifest. A key that did not match installed
  without complaint and then served no bundle, because an add-on's bundle URLs
  are built from its manifest's key.
  
  The server now reads the key and version from the package's `manifest.json`,
  which is inside the bytes the integrity value verifies. The card shows what it
  read ("Uploaded Holiday Calendars 1.0.0 · Install it from the list above") and
  clears the file and hash for the next package. The hash is still required, and
  still has to come from somewhere other than the file itself, such as
  `npm pack --json`.
  
  The upload now runs the full manifest validator. A manifest that does not
  validate, one from a publisher other than Adminium, or an app's manifest is
  refused on the card instead of after the package is staged. Refusals say what
  was wrong: no `manifest.json`, an integrity value that does not match, or an
  archive that cannot be read (with its reason code).
  
  `POST /api/v1/add-ons/upload`: `key` and `version` are now optional. A caller
  that still sends them has them checked against the manifest, and a mismatch is
  refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
  The reply gains `name`.
- 3d627e5: **Uploading an app asks only for the file.** The install wizard's bundle step
  used to ask for the app key and version. The server staged the bundle under
  whatever was typed, and a key that did not match the bundle's manifest uploaded
  fine, then failed on the next step:
  
      The bundle was uploaded as "clinicx" but its manifest declares "clinic".
  
  The bundle already says which app it is, so the server now reads the key and
  version from its `manifest.json` during the upload and returns them with the
  app's name. The wizard's later steps use what the server returned. Stepping back
  after an upload shows the app it read ("Install Clinic Desk · 0.1.1"), with an
  option to upload a different bundle. The optional integrity field stays.
  
  A manifest that does not validate, or that belongs to an add-on, is now refused
  on the bundle step, where the file was chosen. Both used to be staged and then
  refused at the plan step. Refusals at upload also say what was wrong: no
  `manifest.json`, an integrity value that does not match, or an archive that
  cannot be read (with its reason code), where they used to say only "The
  uploaded bundle was refused."
  
  `POST /api/v1/apps/upload`: `key` and `version` are now optional. A caller that
  still sends them has them checked against the manifest, and a mismatch is
  refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
  The reply gains `name`.
- Updated dependencies [7b0e544]
- Updated dependencies [3d627e5]
- Updated dependencies [3d627e5]
  - @adminium/i18n@0.2.8
  - @adminium/charts@0.2.8
  - @adminium/widgets@0.2.8
  - @adminium/engine@0.2.8
  - @adminium/tokens@0.2.8
  - @adminium/ui@0.2.8

## 0.2.7

### Patch Changes

- @adminium/charts@0.2.7
  - @adminium/engine@0.2.7
  - @adminium/i18n@0.2.7
  - @adminium/tokens@0.2.7
  - @adminium/ui@0.2.7
  - @adminium/widgets@0.2.7

## 0.2.6

### Patch Changes

- ce438a0: Browsing add-ons is a browse surface now, not a list of slugs.
  
  **Two defects, both in the catalog projection.** The browse route derived a
  catalog row's name as `entry.name['en_US']`, but the feed keys rows `en`, `de`,
  `zh-cn` — `en_US` has never been present, so the fallback fired every time and
  every online add-on was labelled with its own slug (`barcode-labels`, not
  `Barcode Labels`). Fixing that one key would still have thrown away the seven
  other translations the feed already carries, so the row is now resolved against
  the caller's locale: exact tag, then the normalised tag (`zh_CN` → `zh-cn`, the
  leg without which both Chinese locales silently render English), then the
  language subtag, then `en`.
  
  **The reply carries what the cache already held.** `categories`, `tagline` and
  `connectKind` were parsed from the feed, cached to disk, and then projected away.
  They are now in the DTO, so the page can show what an add-on is and whether
  installing will ask for a credential — the one permission-shaped fact on a card,
  with everything else about an add-on's reach left to the install plan, which is
  the security surface.
  
  **The page is the comp again.** draws a category rail with per-category counts, a
  search box and a card grid; the shipped page rendered a flat list of names. The
  browse half moves to its own component and gains all three, plus distinct empty
  states for "this build shipped none", "nothing matched your filter" and "the
  catalog is on but found nothing".
  
  Browsing remains a disk read: no page load, category click or search makes an
  outbound request.
- ce438a0: Workspace settings links to Add-ons. `/studio/add-ons` shipped with a route and
  no inbound link: the avatar menu lists only Data connections and Workspace
  settings, and no page navigated to it — so the whole add-on surface (browse,
  consent, install, connect, sideload) was reachable only by typing the URL, while
  the self-hosting docs told operators to open it from a menu. It is now a row in
  the settings cross-link card, beside Pages, AI enrichment and Storage, on the
  same Admin+ reasoning: the routes guard on `system:manifests:manage` and the
  page answers a 403 itself, so an admin who could hold the permission finds the
  door rather than a hidden one.
- f73fffc: Three message groups leave the eagerly bundled `common` catalogue: `dataio`
  (the import wizard, exports manager and export builder), `files` (the Files
  library and its upload dialog), and `email`. All three are deferred namespaces
  now, fetched by the surface that owns them.
  
  `common` ships in every user's first load, so a key living there is paid for on
  every route by every user no matter how lazy its surface is. 422 keys had
  collected there that no first paint can render — and 143 of them are `email`
  keys whose every call site is in the server's email-template machinery, i.e.
  text a browser can never display.
  
  **Operators with customised translations:** meta migration `0029` re-files
  overrides written against the old `common:dataio.*` / `files.*` / `email.*`
  addresses. Three keys did not move — two page titles that a statically imported
  route factory reads, and the page-files template's upload hint — so overrides on
  those are COPIED to the twin they now resolve through (`common:nav.imports`,
  `common:nav.exports`, `ui:templates.files.uploadsUnavailable`) rather than only
  moved.
  
  Server-rendered email also needed `createServerI18n` to load the deferred set
  explicitly. Without it every non-English recipient would have silently received
  English — silently, because each call site supplies its own English default, so
  there is no missing-key error to notice.
- 3a38695: The browser tab names the page. `document.title` had one publisher — branding,
  at the root route — so every screen rendered a tab reading "Adminium" and a
  strip of six open tabs said nothing about which page each one was. It is now
  composed by a single owner from two slots: the workspace name, and the screen.
  
  Inside the shell the topbar is the one writer, so the tab mirrors the `<h1>`
  and the two can never disagree. Screens whose heading cannot identify them
  publish a tab name of their own: a record page reads "Amara Osei · Clients ·
  Adminium", a full-page system state names the state rather than the page it
  replaced. Sign-in, the routed 404 and the direct-addressed system states have
  no shell above them and name themselves.
  
  Two Studio screens drew their own header and published none, so the shell's h1
  fell back to "Home" above them — the schema editor, and the AI review, which
  was rendering a second `<h1>` in its summary card. Both now publish their real
  heading, so the topbar, the tab and the body agree.
- f2fd258: Email templates become email documents (WS-A/WS-B). Migration 0026 gives
  `adminium_email_templates` a kind (template | campaign), a category, a fixed footer, a
  preheader, a per-document brand, attachments, archiving and starter provenance, and
  adds `adminium_email_blocks` (saved sections) and `adminium_email_runs` (campaign
  runs). The renderer speaks the comp's 24 block types, draws the brand banner and the
  envelope footer, and references the brand mark and Files images by CID; delivery reads
  attachment bytes from the file store right before `sendMail` and fails loudly on a
  missing file. Twelve localizable starters ship behind `GET /email-templates/starters`.
  
  Routes: `PUT /email-templates/:key/:locale` and `POST /email-templates/:key/test-send`
  are retired — the editor saves explicitly through `PUT /email-templates/:id`,
  and a test send carries the on-screen document (`POST /email-templates/:id/test-send`,
  up to ten recipients). New: create (blank or from a starter), duplicate, add a
  language variation, start a campaign from a template, archive/restore, delete
  (a built-in resets instead), export/import of a JSON bundle, and saved blocks
  under `/email-blocks`. Settings gain `email.senders` and
  `email.maxAttachmentBytes`.
  
  Campaigns, phase 1: `POST /email-templates/:id/send` (workspace users, optional
  roles, now or scheduled) creates an `adminium_email_runs` row and one
  `email.campaign-run` job; `POST /email-templates/:id/audience/preview` counts
  recipients and opt-outs; `GET /email-templates/:id/runs` lists a campaign's
  runs; `POST /email-runs/:id/cancel` cancels a scheduled run or cooperatively
  stops a running one. The `email.campaign` notification kind is the opt-out;
  `email.campaign.sent` tells the creator how many were sent and failed.
  
  Dashboard: the Email templates manager is rebuilt to the design (WS-C):
  Templates/Campaigns trays with counts, group by topic or language, gallery and list
  layouts remembered per browser, the actions menu (import, senders, export, settings,
  archived), inline rename, duplicate and delete with Undo, archived mode with restore
  / delete for good / reset to built-in, the New modal with the twelve starters and
  *Your templates* for campaigns, and the import modal. The old autosaving page under
  `pages/builders` is gone; the editor route (`/email-templates/:id`) shows the
  document's facts until the new editor lands.
  
  The Email templates surface's messages move to a deferred `email` namespace
  (`DEFERRED_NAMESPACES`), loaded by its two routes like the studio's: the
  strings no longer ship in every user's entry chunk. `GET /i18n/bundle/:locale/email`
  serves it; the overrides budget counts it.
  
  The editor (39 WS-D/WS-E): a live canvas of the 24 block kinds plus the two
  legacy ones, inline subject and preheader, the inspector's Sections and Design
  tabs (five panels, a rows editor, eight style axes, saved blocks), explicit save
  with `Ctrl/⌘+S`, sixty steps of undo, a discard-changes guard, language
  variations with the mirror question for structural edits, the image picker
  (workspace files, upload with the connection rule, https URLs), workspace
  documents as attachments, test sends of the on-screen document to several
  addresses, and — for a campaign — *Send campaign* (workspace users by role,
  now or scheduled, the live recipient count), the *Scheduled · time* / *Sending
  · N %* chip with an explicit cancel, and live progress on the run's job channel.
  Every string of the surface, the twelve starters and the blank copy are in all
  eight languages. Two guides (`guides/email/`, `guides/email/campaigns/`) document
  templates, campaigns, attachments, senders, opt-out and what is not tracked.
- 3a38695: Three more built pages get an entry point. An audit of every route for inbound
  navigation found `/studio/add-ons` was not alone:
  
  - **`/studio/public-api`** had exactly one inbound link — inline prose on the
    Hosted apps page, rendered only for a customer-side surface with no key bound
    yet. So it was unreachable without hosted surfaces, and the link removed
    itself the moment someone bound the key it sent them to mint. It is now a row
    in the Workspace settings cross-link card; the contextual shortcut stays.
  - **`/api-keys`** had none at all. It joins the sidebar's `people` group beside
    Team, Roles and the audit log — a key is a principal that carries a role, not
    a personal preference — gated `adminOnly` like its neighbours.
  - **`/help` and `/changelog`** had none at all. Both are for every role (the
    router's own note: a viewer hitting a wall needs the docs more than an admin
    does), so they go in the avatar menu below the admin-only Studio section.
- 3a38695: The sidebar's platform tail no longer waits for a database. With no `nav.groups`
  the rail rendered the "Pages appear here once a database is connected" prompt
  and returned, which skipped the platform-only groups entirely — so on a fresh
  instance Team, Roles & permissions, API keys, the audit log, Files, Email
  templates, imports, exports and scheduled reports were all invisible until a
  source was connected, which none of them need. Inviting people is the first
  thing an admin does, and Team was behind that wall.
  
  The prompt now says only what it means — an explanation for the missing pages —
  and renders alongside the tail rather than instead of it. The admin gate is
  unchanged: a viewer still sees only the ungated rows.
- cb398f1: The Report builder ships at `/report-builder`: a two-collection manager
  plus a block editor, over a new envelope — a report is a header (kicker · title ·
  subtitle) plus an ORDERED ARRAY of self-contained blocks, each with its own title,
  width and visibility, drawn from a palette of 25 kinds. Migration 0030 adds
  `adminium_report_documents` (prefix `rpt`): one table, two kinds (template |
  report), the comp's three-value status (draft | sent | live), a starter key, a
  soft `origin_id`, the manager's `position` and a denormalised `summary`.
  
  Not Scheduled Reports. That surface keeps `/reports`, its `reports.*` keys, the
  `rep` prefix and `system:reports:manage`; this one is `/report-builder`, the
  `reportBuilder` namespace, `adminium_report_documents` and
  `/api/v1/report-documents`, and its writes ride `system:settings:manage` like
  the other two document surfaces. No permission key is added.
  
  Server: nine routes in the invoice surface's shape — list with unfiltered tab
  counts, the twelve starters, detail, create (blank or from a starter), the
  explicit `PUT` save that re-derives the summary, inline rename, duplicate,
  delete, and `POST /:id/from-template`, which copies a template's body into a
  new report and records its origin. The envelope decodes leniently and holds
  both inline-image slots to the existing caps; a block of an unknown kind
  becomes a labelled placeholder rather than a card nobody can explain.
  
  Dashboard: the manager (Templates/Reports trays with counts that ignore the
  search box, client-side search over name · title · kicker, gallery and list
  layouts remembered per browser, four empty states, inline rename, duplicate
  with Undo, delete behind a confirm, the New modal with twelve starters and
  *Your templates* for reports) and the editor (the 25-kind palette, the always-
  light sheet with its background image and tint, the block stack with drag and a
  keyboard reorder, half-width blocks, the *Show in export* flag, an inspector
  whose 25 field groups each carry Width · Show · Delete, explicit save with
  `Ctrl/⌘+S`, sixty steps of undo and a discard guard). A template's primary
  saves; a report's *Publish* saves and marks the row Published. Below `lg` the
  inspector becomes a drawer and the palette an *Add block* sheet.
  
  Two gaps in the design are filled with its own patterns: the image block gains
  the background's Upload / Replace / Remove row, and a KPI metric gains the
  *Delta* field that makes its rendered delta reachable. Two of the design's own
  defects are corrected: the block label/glyph pair is a record with named fields
  (the pair ships swapped for four kinds), and a card's glyph rides its row
  rather than a title match, so renaming a report never changes its icon.
  
  Every string of the surface, the twelve starters and the seeded block content
  are in all eight languages, in a deferred `reportBuilder` namespace loaded by
  its two routes — the strings never ship in a user's entry chunk.
- Updated dependencies [ce438a0]
- Updated dependencies [ce438a0]
- Updated dependencies [9f47a62]
- Updated dependencies [f73fffc]
- Updated dependencies [f2fd258]
- Updated dependencies [3a38695]
- Updated dependencies [cb398f1]
  - @adminium/i18n@0.2.6
  - @adminium/widgets@0.2.6
  - @adminium/charts@0.2.6
  - @adminium/engine@0.2.6
  - @adminium/tokens@0.2.6
  - @adminium/ui@0.2.6

## 0.2.5

### Patch Changes

- @adminium/charts@0.2.5
  - @adminium/engine@0.2.5
  - @adminium/i18n@0.2.5
  - @adminium/tokens@0.2.5
  - @adminium/ui@0.2.5
  - @adminium/widgets@0.2.5

## 0.2.4

### Patch Changes

- @adminium/charts@0.2.4
  - @adminium/engine@0.2.4
  - @adminium/i18n@0.2.4
  - @adminium/tokens@0.2.4
  - @adminium/ui@0.2.4
  - @adminium/widgets@0.2.4

## 0.2.3

### Patch Changes

- 36fb706: The Studio add-ons page can now acquire an add-on, not just install one that is
  already there.
  
  Three things it could not do before, and each was missing for its own reason.
  
  **A download is a job, and the page treated it as a request.** `POST
  /add-ons/download` answers `{ jobId }` the moment the work is enqueued — the
  bytes arrive later, on the worker, with its retries and its cancellation. The
  page reported success on that reply, so an operator saw "done", refreshed, and
  found nothing staged. It now follows the job to an actual terminal state and
  shows what step it is on. A failure is reported as the failure it was, with the
  server's own reason, rather than as a download that quietly did not happen.
  
  **Sideload had no surface at all.** The route existed; nothing in the product
  reached it, which left an air-gapped operator with a documented capability and
  no way to use it. The form asks for the package, its key, its version and its
  `sha512-…` integrity — and the hash is required rather than optional. That path
  runs the identical verify-then-hardened-unpack a registry download runs, one
  code path for bundled, npm and upload, so it needs the same thing a download
  gets from the registry: a hash supplied by something other than the bytes being
  checked. `npm pack --json` prints exactly that value, so the person doing the
  sideloading can produce it without trusting this page. Computing it from the
  uploaded file would have been verifying the bytes against themselves.
  
  The key and version are asked for rather than read out of the tarball,
  deliberately: the store's directory grammar is `<key>/<version>/`, and deriving
  either from a filename an operator can rename is how a package ends up staged
  under somebody else's name.
  
  **The online-catalogue switch had no route to write to.** It is a
  settings-registry boolean, and every other one lives under `/settings/*` — which
  is gated on `settings.manage`. That is precisely the permission the add-on wave
  spent a task un-reserving `manifests.manage` to avoid: a switch deciding whether
  this deployment talks to a package registry is not the same authority as
  renaming a workspace. So it is `PUT /api/v1/add-ons/catalog`, under the add-ons'
  own permission, audited like everything else there.
  
  The reply carries something the design did not anticipate. `ADMINIUM_NETWORK_FEATURES=off`
  and desktop air-gap mode outrank the stored setting, so an operator can switch
  browsing on and have it stay off. The route reports the **effective** state plus
  whether an environment veto is overriding it, and the page says so in words — a
  toggle that springs back with no explanation reads as a broken page rather than
  as a policy.
  
  The plan also asked for a cache invalidation hook here, on the pattern the
  public-API gate uses. There is nothing to invalidate: the catalog client reads
  the setting on every call and caches nothing. Building the hook would have been
  a no-op with a name implying otherwise.
  
  Fourteen new strings across all eight locales, German and French translated, the
  rest drafted from English and marked for review the way the i18n gate expects.
- 4d68dc9: Add-ons can now be installed, attached to a host, switched off per host, and
  uninstalled — and `manifests.manage` became a real permission.
  
  Plan 32 got a verified package onto local disk and stopped there. This is the
  first half of what happens next: the meta surface, the install planner, and the
  routes. It is deliberately not the whole runtime — see the end for what still
  refuses.
  
  **`adminium_manifests` already existed.** It has shipped since migration 0006
  with no repo, no writer and zero rows, and three planning documents recorded it
  as absent. So migration 0020 ALTERs rather than creates, adding `kind`, and
  `licenseKeyEncrypted` — a column plan 17 defers by name — is left in place and
  read by nothing rather than dropped, because it is empty and dropping a column
  is the one thing a migration cannot take back.
  
  **Attachments are a join table.** The wave's plan originally recommended two manifest rows keyed
  `(manifest_key, attached_to)` for an add-on attached to two hosts; that recommendation was withdrawn and the
  join table ratified. Three costs argue against it, and the third only became visible once the table turned
  out to be shipped: two rows mean two copies of the manifest document, which an upgrade must then rewrite
  atomically or leave one host on an older version; the credential FK becomes ambiguous, since a DHL API key
  belongs to the add-on rather than to one of its attachments, so disconnecting "the other one" either orphans
  a secret or deletes a live one; and it requires dropping and recreating the shipped
  `uq_adminium_manifests_manifest_key` across three dialects, against own "never edit a shipped migration". An
  attachment is a many-to-many fact and now has the table that models one. `disabledAt` lives there rather than
  on the manifest, so an add-on can be live on one host and off on another — which a single flag could not
  represent.
  
  **Credentials get their own key, not the DSN's.** `deriveKey`'s `info` parameter
  exists to keep purposes apart, and these are genuinely different: a DSN opens
  the operator's own database, an add-on credential opens a third party's API on
  their behalf. Sharing a key would mean a leak of either is a leak of both, and
  rotating one to contain an incident would silently invalidate the other. The
  ciphertext column is called `payload`, which none of the log-redaction patterns
  matched — `payload` is now redacted, along with `refreshToken` and `accessToken`.
  That will redact some innocent job payloads too; an un-redacted credential in a
  log costs more than a debugging session does.
  
  **`planInstall` is a document, not a step.** The consent dialog is the security
  surface, so what it shows had to be computable without side effects and
  renderable even when the answer is no — a refusal is data, not an exception that
  leaves the dialog with nothing to draw. The case that makes it non-trivial is
  the foreign key pointing *out*: two of the three shipped add-ons that declare
  tables reference tables they do not own (`design-studio.job_id → jobs`,
  `personalizer.product_id → products` and `order_line_id → order_lines`). Those
  belong to the host, so a reference resolves as internal, host, or unresolved,
  and only the third stops an install. A planner that only emitted DDL would find
  that at `CREATE TABLE`, having already created the other tables — on MySQL,
  which has no transactional DDL, permanently.
  
  **`manifests.manage` is grantable, in the same change that landed its first
  enforcement point** — which is the rule its own reserved list documents. It went
  to `operations` rather than `workspace`: installing an add-on runs its server half
  in this process, which is closer to starting a job than to changing a setting,
  exists precisely to stop it riding on `settings.manage`. The reserved set had four
  hard-coded copies rather than the two that were expected, and one of them is
  production code — `RESERVED_GRANTS` in the dashboard's `rolesApi.ts`, which the
  dashboard cannot import from `@adminium/meta`, so nothing detects drift and a key
  left there is silently dropped from the matrix with no error and no failing test.
  
  Applying a plan that needs new tables lands in the same release — see the
  add-on schema changeset — so an add-on whose tables the host database already
  has and one that brings its own both install completely.
  
  Uninstall deletes the meta rows and the package directory and touches the data
  source not at all, so every table an add-on brought stays with its rows; the
  reply says so, rather than leaving the UI to assert it. And 26's acceptance #8 —
  "a composeServer-level test that fails if a route is exported but unregistered"
  — finally has one. Nothing enforced it before: the M10 regression test checks a
  hard-coded URL list, audit coverage only sees routes that are registered, and
  the OpenAPI check reads the built spec. All three are blind to exactly the gap
  that shipped green twice.
- 4d68dc9: Installing an add-on now creates the tables it declares.
  
  Until now an add-on whose `requiredSchema` named a table the database did not
  have was refused whole, with `ADD_ON_DDL_REQUIRED` and a list of table names.
  That covered every add-on attaching to data a host already had, and refused the
  three shipped ones that bring their own.
  
  **There is no SQL in the implementation, and that is the point.** The work was
  priced as a `requiredSchema` → DDL emitter written three times, once per
  dialect, because the only existing exemplar — the desktop runtime's SQLite
  importer — is exactly that. It was not needed: a connection hands back a real
  Kysely instance, whose schema builder already compiles `CREATE TABLE` correctly
  for postgres, mysql and sqlite. What was actually missing was a map from the
  manifest's fifteen abstract column types to a column type per dialect, and the
  rules for what order to create tables in.
  
  Three entries in that map differ from the meta store's answer for the same
  abstract type, and each difference is deliberate. An `id` is `varchar(36)` and
  never `char`, because a blank-padded character column hands the padding back on
  every read. A `timestamptz` is a real timestamp rather than the epoch-
  milliseconds integer the meta store uses, because these tables sit in the
  operator's own database beside their own data, where a `created_at` holding
  `1750000000000` is unreadable to every other tool they point at it. And `money`
  is `decimal(19,4)`, because binary floating point cannot represent a tenth of a
  cent.
  
  **A foreign key names a table, not a column,** so the target's primary key has
  to be resolved — from the manifest for a table this install is creating, from
  the live schema for one the host owns. A target with a composite primary key, or
  none, is refused rather than guessed at: assuming `id` would create a constraint
  against a column that may not exist. Constraints are emitted named and
  table-level, because MySQL parses the inline column-level form and then silently
  discards it.
  
  **The install is re-runnable rather than transactional,** which is the only
  property MySQL leaves available — it commits each DDL statement implicitly, so a
  multi-table install cannot be rolled back. Every create is `IF NOT EXISTS`,
  tables are emitted in dependency order, and the DDL runs *before* the manifest
  row is written. A failure halfway leaves real tables and nothing registered, and
  retrying completes the install rather than colliding with it. The reverse order
  would leave an add-on registered against tables that are not there.
  
  **Which database an add-on installs into is now answered explicitly.** An
  instance may have several connections and a manifest names none. The tables go
  where the host app it attaches to reads — which is the only answer that makes a
  foreign key into the host's data possible — falling back to the sole connection
  when the add-on attaches to no app in particular. When neither rule resolves,
  the install is refused and says why. Creating tables in the wrong database
  succeeds, returns 200, and is discovered much later by an operator wondering why
  an add-on's list is empty.
  
  The consent dialog says all of this before anyone agrees to it: it names the
  tables that will be created, and repeats that uninstalling later leaves them and
  their data alone. That promise is now checked against a database rather than
  asserted — install creates a table, a row goes into it, the add-on is
  uninstalled, and the row is still there.
  
  **One thing install still refuses:** adding columns to a table that already
  exists. Creating a table an add-on asked for is one conversation; altering one
  the operator already owns is a different one, and it is theirs to have. The
  dialog names the missing columns instead of offering a button that fails.
- 36fb706: Add-ons have a Studio page: browse, consent, connect, enable per host, uninstall.
  
  Thirteen tasks of server work become something an operator can use.
  `/studio/add-ons` presents them in the order they actually matter — what is
  available, what installing would do, what is installed — and the design input
  supplies the shapes while this supplies the data story behind them.
  
  **Browsing is a disk read, and the page says so.** A fresh install lists what
  came with the build, with no network call at all, so it is useful before anyone
  decides whether to switch the online catalogue on. When that switch is off there
  is no "check for newer" button to press — an action that could only fail is
  worse than an absent one — and the copy states plainly that nothing here has
  contacted the internet. When it is on, checking is a visible action rather than
  something the page does on load.
  
  **The consent dialog is the security surface, so it shows the plan first.**
  calls it that explicitly, and what it shows is the real server-computed plan:
  the tables an add-on will use, the tables installing will CREATE, the hosts it
  may contact, and — when the answer is no — the reason, in a sentence naming the
  missing table. Install is not offered for a plan that cannot be applied. The
  one schema case that stays refused is a table that exists but lacks columns the
  add-on needs, and the honest surface for that is the plan naming those columns,
  not a button that would fail.
  
  **Three outcomes get three sentences.** Disable keeps everything and is one click
  to undo. Disconnect deletes the keys and keeps every table and every row.
  Uninstall additionally removes the files from the server, and still keeps every
  table and every row. A shared "are you sure?" would make the safest of the three
  read like the most destructive, so each confirm says what it actually does — and
  each says the data survives, because that is the promise makes and the dialog is
  where a person either believes it or does not.
  
  Fifty-one keys across all eight locales, German and French translated, the rest
  drafted from English and marked for review the way the i18n gate expects.
- 7e5f704: A data connection can now be PAUSED instead of deleted.
  
  Deleting was the only way to stop Adminium touching a source database, and it
  takes the generated pages with it — so "turn this off for the migration
  window" and "I am done with this database" had one button between them. Studio
  → Data connections now carries a Pause/Resume action per card.
  
  The state is a new `adminium_connections.disabled_at` column (meta wave 0019),
  deliberately NOT a `status` value: `status` is a health reading and every
  connection test overwrites it, so a pause folded into that enum would be
  silently undone by the next successful probe — and a connection that was
  FAILING when it was paused would lose that reading on the way. Health is
  observed, a pause is intended; two facts, two columns, and the card can say
  "paused, and it was failing when you paused it". The timestamp (rather than a
  boolean) is what lets the card say *how long* — a source paused for an hour
  during a migration and one paused five weeks ago and forgotten are the same
  boolean and very different situations. NULL means serving, so no backfill.
  
  Enforcement is at the source-database boundary, not in the UI that offers the
  button. `ConnectionManager.data/dataAdapter/introspectAdapter` refuse with a
  new 503 `CONNECTION_DISABLED`, which is what covers every caller with no
  operator in the loop: scheduled reports, export and import jobs, quick search,
  widget refreshes and the public API. The check runs ahead of the pooled-handle
  cache on every call, because the pool is process-local and a pause is a row in
  the meta store — checking only on a cold open would leave a warm handle in a
  second server process serving a source somebody had switched off. Pausing also
  disposes the pool, so a paused connection holds no sockets open. `mustFind`
  deliberately does NOT refuse: Studio has to be able to read and resume the row.
  
  - `PATCH /api/v1/connections/:id` accepts `disabled`, audited under its own
    `connection.disable` / `connection.enable` actions. Omitted leaves the pause
    alone, so a rename never resumes a source by accident.
  - `POST /connections/:id/test` and `/introspect` refuse while paused — the
    introspect refusal lands before the job is enqueued, so the operator is told
    while they are still looking rather than by a job that fails out of sight.
  - The public API maps the refusal to its own `PUBLIC_UPSTREAM_UNAVAILABLE`:
    that surface's callers are the tenant's customers, who cannot resume
    anything and should not learn the operator switched a database off.
  - A paused connection's pages leave the SIDEBAR, and every other surface that
    enumerates pages with them: the command palette, G-chord jumps, the 404's
    suggestions, and the page pickers in scheduled reports, exports and imports
    (all of which read `flattenNav(bootstrap.nav)`). They leave `hiddenPages`
    too — that list is still enumerated by record-page related tabs and
    cross-links, and a paused source must be enumerable by nothing. Quick search
    drops the connection from its candidate set rather than dialling it and
    degrading every table to a `partial: true` group.
  - They travel in a new `pausedPages` bootstrap field read by exactly one
    caller: the `/p/<slug>` URL resolver. A bookmark, or a tab that was open when
    the pause landed, renders the `connection-paused` state instead of a 404 —
    the page has not gone, its database has.
  - Pausing publishes on the `config-changed` realtime channel, so every signed-in
    session drops its bootstrap cache. The operator who flips it is rarely the
    only person looking at the sidebar.
  - Pages over a paused connection get a new `connection-paused` system state
    and a matching template panel — "This connection is paused", calm tone, and
    no Retry button, because retrying cannot change the answer until a person
    resumes it. The four data templates that render an error panel share one
    `describeDataError` helper for it.
  - The desktop runtime chip stops counting a paused remote as either reachable
    or offline; the hub's "healthy" count drops it and the header says how many
    are paused, but only when some are.
- 8ed7972: Fix the Email Templates builder rendering an empty canvas for every stored template.
  
  The surface was non-functional in both directions on every install, and had been
  since it shipped. `apps/server/src/email/render.ts` owns a closed six-kind
  vocabulary — `email.heading`, `email.text`, `email.button`, `email.divider`,
  `email.spacer`, `email.footer` — and that is what `seedBuiltinEmailTemplates`
  writes to `adminium_email_templates` at every boot and what `renderEmail` turns
  into MIME. The builder canvas knew a different vocabulary entirely: the 22
  `block-*` document ids (`block-line-items`, `block-tax-breakdown`,
  `block-qr-pay`, …). The intersection was empty.
  
  So `emailDoc.ts` classified every block of every seeded row as `unknown`,
  `blockOrder` came out `[]`, and the editor opened on "No blocks yet" for all 24
  rows a fresh install seeds (3 built-ins × 8 compiled locales). The reverse trip
  failed the same way: the palette could only offer `block-*` ids, `renderEmail`
  skips any kind outside its vocabulary, so anything an admin added was saved,
  shown as saved, and then silently dropped on send.
  
  **Neither half ever failed loudly, and that is why CI stayed green.** An
  unrecognised kind is *skipped* on both sides — deliberately on the server, where
  throwing would turn a stale row into a 500 on the password-reset path and lock
  someone out of their own account. The only coverage the surface had fed it
  hand-written docs made of `block-highlight-box` / `block-contact`, ids the canvas
  already knew and the mail renderer never did, so the one broken thing was the one
  thing nothing exercised.
  
  **The canvas moved to `email.*`, not the other way round.** The stored
  vocabulary is the wire format of a production table and of sent mail; the
  `block-*` set is a UI list. Changing code is free, migrating seeded rows in every
  install is not. A mapping between the two was never an option either: the 22
  document blocks contain no heading, paragraph, button, divider, spacer or footer,
  so nothing could express a transactional email, and a lossy round trip would have
  written `block-*` into stored rows — upgrading a broken editor into one that
  blanks real password-reset mail. The Email Templates comp settles it too: its
  inspector is Heading / Body paragraphs / Call-to-action / Footer text, and the
  five ecommerce modules that `DOC_TYPE_BLOCKS.email` used to hold are the comp's
  *optional* rail. They are still there, one click down the palette.
  
  Six canvas blocks back the kinds (`BlockEmail.tsx`). They read the stored payload
  bare rather than through `rowOf`, because that payload is the template entry's own
  `data` object and wrapping it would mean rewriting what the server sends.
  `email.button` renders as a styled span plus its destination in mono, not an
  `<a href>`: this is a preview inside an editor, a real link would navigate away on
  the click meant to select the block, and the href is usually an unresolved
  `{{resetUrl}}`. The heading renders as a weighted `<p>` carrying `data-level` —
  the canvas already emits an `<h3>` block label, so a real `<h1>` inside it would
  invert heading order on every template.
  
  **Payloads are now keyed by instance id, not block id.** Repeated kinds are the
  ordinary case here — `password-reset` has an `intro` paragraph and a `notice`
  paragraph, both `email.text` — and block-keyed storage collapses the two, showing
  one sentence twice while the other is unreachable. `blockDataForInstance` reads
  the instance id first and falls back to the block id, so no existing invoice or
  report doc changes shape. For the same reason the canvas now emits
  `blockInstanceOrder` alongside `blockOrder`: two instances of one kind produce an
  identical sequence of block ids, so "swap the two paragraphs" was a silent no-op.
  
  Because `apps/server` may not import `@adminium/widgets` and there is no runtime
  package both depend on, the vocabulary crosses that boundary the way the LLM
  allow-lists already do — declared on each side, held identical by
  `scripts/check-email-block-vocab.mjs` in CI. The gate compares both lists in
  order, checks each kind actually reaches a renderer on both sides, and checks
  that `BLOCK_IDS` still spreads `EMAIL_BLOCK_KINDS`: an earlier draft that compared
  only the two lists passed happily while `isBlockId` rejected all six kinds, which
  is the exact failure being fixed.
  
  Regression coverage runs a row copied verbatim out of a seeded install's meta
  store through `emailDoc.ts` into the rendered page, and asserts six block
  instances, two distinct paragraphs, a byte-identical round trip, and no empty
  state. The server side asserts every vocabulary kind renders non-empty HTML, that
  the real `builtins.ts` seed emits only vocabulary kinds in all eight compiled
  locales, and that an unknown kind is still skipped rather than thrown on.
- ac3f5e7: FK chips in generated grids now show the referenced record's display value
  ("Drift & Fern") instead of the raw foreign-key id ("5"), wired through the
  existing `lookup=` machinery — no new server surface.
  
  The grid spec's `fk` block always defined `displayKey` (a row key carrying a
  pre-joined display value) but nothing ever populated it, so `FkChipCell` fell
  back to the raw id on every generated page and owners added a separate linked
  column just to see who a row points to. The missing fact was the referenced
  table's display column, which only the generator knows:
  
  - The crud composer stamps a new optional `fk.display` — the referenced
    table's classified display column — into each FK column spec, from a
    `displayColumns` map (`crudDisplayColumns`) built over the included
    candidate model. Stamping is pre-checked at generation time: skipped when
    the referenced display column is secret (the server hard-422s lookups on
    secret identifiers), when it IS the referenced column, and when the derived
    alias would shadow a real source-table column or break the server's alias
    grammar.
  - The dashboard interpreter (`withFkDisplay`) turns each `fk.display` into a
    `lookup=<name>__display:<name>.<display>` read param and stamps
    `fk.displayKey` so the chip picks the joined value up — on list pages,
    record pages, and record-page related tabs. Explicit lookup columns keep
    absolute priority inside the server's MAX_LOOKUPS=12 budget; derived params
    only spend what is left and drop deterministically (with a console note)
    beyond it. A column already covered by an explicit single-hop lookup of the
    same display value reuses that alias instead of spending budget on a twin.
  - Masking degrades honestly: a PII display column the caller may not read
    arrives as `null` + `_masked`, and the chip falls back to the raw id —
    never a blank chip.
  
  The field is optional and regeneration-composed: stored pages predate it and
  keep today's raw-id fallback untouched until their next regeneration (whose
  `generatedHash` move rewrites untouched generated pages in place — that hash
  move is the delivery mechanism, and the northwind baseline was re-recorded in
  this change to pin it). Columns re-added through the Studio column manager
  stay unstamped until regeneration — the schema reply does not carry the
  referenced table's display-column pick.
- 37c99f2: The Studio's messages are their own namespace, and nobody downloads them until
  they open the Studio.
  
  `studio` was always meant to be a namespace that loads lazily when a Studio
  route mounts, with keys of the shape `studio:connect.wizard.testCta`. The
  build never did it. All 971 console
  messages lived in `common.studio.*` and `common.studioPages.*`, and every en-US
  namespace was imported statically into the caller's main chunk — so the connect
  wizard, the schema remap editor, the LLM review screens and the workspace
  settings hub were downloaded, in English, by every user on every route, on top
  of their own locale's copy of the same text.
  
  Nothing caught it. The cross-locale parity gate proves the eight bundles agree
  with each other, and agreeing about the wrong namespace is still agreement.
  
  They are `studio:*` and `studio:pages.*` now, in all eight locales, fetched by
  the Studio through the same spinner its lazy route bodies already showed. The
  dashboard's entry chunk drops **15 KiB gzipped**, which is the difference
  between a build that was over its size ratchet and one that is 60 KiB under the
  v1.0 target.
  
  Three things had to come with them, and each is the kind of thing that would
  have been found in production rather than in CI.
  
  **The inline fallback became load-bearing.** `t('studio:hub.title', 'Data
  connections')` renders its second argument until the chunk lands, and in every
  unit test that never boots i18next. While the catalogue was always present that
  argument was decoration; now it is the text on screen for a moment. All 1,057
  were compared against the bundle and one had drifted — a settings helper still
  describing a control that had been reworded. A test now compares every one of
  them, character for character, so the next drift fails a build instead of
  flickering on a page.
  
  **A deferred namespace cannot be read outside the surface that loads it.** The
  topbar titled its two Studio menu items from `studio.hub.title` and
  `studio.settingsHub.title`, and the topbar paints on every route — after the
  move it would have shown English to a German admin until they opened the Studio.
  Those two items have their own `topbar.*` keys, and a test fails the build on
  any `studio:` key read from outside `src/studio`.
  
  **And the overrides had to move with the messages.** An operator who reworded a
  Studio string through the Translations editor had a row filed under
  `(common, studio.hub.title)`, and a row is addressed by namespace and key — so
  the rewording would have stopped resolving the moment the message answered to a
  new address. Not with an error: the string would simply revert to the compiled
  English, on the one surface whose users are the people who did the rewording.
  Meta migration 0022 re-files those rows. It also *copies* rather than moves an
  override on the two keys the topbar gave up, so an operator who renamed "Data
  connections" does not end up with a menu item and the page it opens disagreeing.
  
  The client half is the same problem one layer up: the boot path fetches override
  rows for the eagerly-bundled namespaces only, which was correct while every
  Studio key was a `common` key. The Studio now fetches its own overrides
  alongside its compiled bundle, and the server's per-locale override budget
  counts the namespace — deferring bytes is not the same as not sending them.
  
  One note for anyone reading the bundle numbers. Moving the keys, on its own,
  made the entry chunk *larger*. `@adminium/i18n`'s barrel re-exported the
  complete en-US catalogue, and a re-export keeps its module statically reachable
  — which in turn pinned the override layer's *dynamic* import of that same module
  into the entry, because a module the bundler can reach statically cannot be
  split out. The note directly above that export had predicted this about two
  other modules. Deleting the one line is essentially the entire 15 KiB.
  
  `EN_US_RESOURCES` is therefore no longer exported from `@adminium/i18n`; import
  it from `@adminium/i18n/resources`, which is where every consumer in this repo
  already got it. `NAMESPACES` keeps its meaning (all five), and
  `EAGER_NAMESPACES` / `DEFERRED_NAMESPACES` are exported alongside it so which
  side of the split a namespace is on is a declaration rather than a comment.
- Updated dependencies [36fb706]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [36fb706]
- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [ac3f5e7]
- Updated dependencies [37c99f2]
- Updated dependencies [9e1adf7]
- Updated dependencies [9e1adf7]
- Updated dependencies [9e1adf7]
  - @adminium/i18n@0.2.3
  - @adminium/widgets@0.2.3
  - @adminium/engine@0.2.3
  - @adminium/ui@0.2.3
  - @adminium/charts@0.2.3
  - @adminium/tokens@0.2.3

## 0.2.1

### Patch Changes

- Updated dependencies [4091a4f]
  - @adminium/i18n@0.2.1
  - @adminium/widgets@0.2.1
  - @adminium/engine@0.2.1
  - @adminium/tokens@0.2.1
  - @adminium/ui@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Rework the CLI setup wizard's prompts, output, and ending.

  The wizard now has a visual grammar: one continuous vertical rail down the left margin with a glyph per step — `◇` settled, `◆` current, `▲` wants attention. Previously every line printed at column 0, so a seven-step flow read as an undifferentiated transcript with no way to tell decisions from narration. Adds width-correct clipping (styling applied after the clip, since escape codes otherwise measure as visible columns and can be severed mid-sequence), word-boundary wrapping for prose, and a scrolling viewport for long pickers — a frame taller than the terminal cannot be rewound without the redraw eating the lines above it.

  Also lifts the wizard's pre-hidden-table rule into `@adminium/engine` as `isPreHiddenTable`. The Studio hid Adminium's own `adminium_*` store, other tools' migration bookkeeping, and join tables from its first commit, while the CLI wizard was still offering `adminium_users` as a table to build an admin panel over — generation declines to page all three regardless, so that selection could never be honoured. One rule, beside the classifier that assigns the roles, shared by both front doors.

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0
  - @adminium/i18n@0.2.0
  - @adminium/ui@0.2.0
  - @adminium/widgets@0.2.0
  - @adminium/tokens@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
  - @adminium/i18n@0.1.0
  - @adminium/tokens@0.1.0
  - @adminium/ui@0.1.0
  - @adminium/widgets@0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
