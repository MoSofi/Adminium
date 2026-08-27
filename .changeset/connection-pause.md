---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A data connection can now be PAUSED instead of deleted.

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
