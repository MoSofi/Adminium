# Kiln Street Pottery — the second "save as app" fixture

Fernhill (the Postgres sandbox at `~/Work/sandbox/fernhill`) starts from a
database that already has its tables, and it has no endpoints, option lists,
document profiles, add-ons, payments or translations. Saving it as an app and
installing it somewhere else therefore tests only half of what an app file
carries. This fixture covers the other half. It is a small instance, built
from nothing through the API, where every one of those pieces is made the way
a person would make it.

**Kiln Street Pottery** is a pottery studio with members, classes, kiln
firings, pieces and a small shop. The clock is Europe/London and the currency
is GBP.

## What it builds

All routes are under `/api/v1`. Steps run in this order:

| # | Piece | Made through |
|---|---|---|
| 1 | A connection to a **new, empty SQLite file**, with its clock and currency set | `POST /connections`, `PATCH /connections/:id`, `POST /connections/:id/generate` (introspects the empty database so Studio has a base) |
| 2 | **Tables made in Studio**: `members`, `classes`, `firings`, then `pieces` and `shop_orders` (foreign keys to the first round). Logical types only: enums, `decimal(10,2)` money, dates, uniques. Pages for them are made by adopting them, as Studio does after an apply | `POST /connections/:id/schema/plan` → `/schema/apply` (two rounds), `POST /connections/:id/schema/adopt` |
| 3 | **36 rows**: 8 members, 5 classes, 4 firings, 12 pieces, 7 shop orders | `POST /data/:conn/:table/one-by-one` |
| 4 | **An option list**, `glazes` (5 glazes with tones), bound to `pieces.glaze`, which is a plain `varchar` column and not a database enum | `POST /option-lists`; `PUT /connections/:id/overrides` (`column.options`) |
| 5 | **A second language**: only `en_US` and `fr_FR` are switched on. The tables and three columns get French labels, and one piece of UI wording is edited in French. The way to pay in step 9 is named in both languages too | `PATCH /i18n/locales/:locale`; `table.label` / `column.label` overrides with both locales; `PUT /i18n/keys` |
| 6 | **A public endpoint**: `/upcoming_classes`, a read-only (`GET`) list of classes with six fields, ordered by start date. The public API is switched on. No key is minted, because keys never travel in an app | `PUT /public-api`, `PUT /public-endpoints/:conn/upcoming_classes` |
| 7 | **An add-on**: the bundled *Invoices & Receipts* (`invoices`), installed with no app | `GET /add-ons/catalog`, `POST /add-ons` |
| 8 | **A document profile**: "Shop receipt" on `shop_orders`, using the invoices add-on's receipt kind (or its invoice kind if there is no receipt kind) | `GET /documents/kinds`, `POST /documents/profiles` |
| 9 | **A payment profile**: `shop_orders` is payable. The label is `number`, the amount is `total`, the currency is the connection's, payment state is read from `status` (`paid` / `refunded`), and the customer email is `customer_email`. There is also one way to pay that needs no keys: *Pay at the studio counter* (the manual cash-on-delivery way) | `POST /payments/payables`, `PUT /payments/ways/manual/cash-on-delivery` |

Adminium is never a party to a payment. The fixture only sets payments up: it
uses no provider, no keys and no test card. Test secrets of any kind are left
out on purpose.

The run is **deterministic**: same tables, same rows (ids 1..n, because the
database is new) and same settings every time. It refuses to run if a
connection named "Kiln Street Pottery" already exists. Point it at a fresh
server.

**Engines.** It asks the API for logical types only, so the same requests work
on Postgres and MySQL (`--dsn`). Table ids such as `main.x`, `public.x` or
`<db>.x` are read back from the snapshot, never assumed. The intended use is
to build it on SQLite and install the saved app on Postgres and MySQL.

## Running it

You need a running server built from this checkout (`pnpm build`) that has the
invoices add-on staged (see below). Then:

```bash
# A brand-new server with no account yet: --setup creates the first super admin
# (it lands signed in, so no sign-in is spent).
node apps/e2e/fixtures/own-apps-kiln/build.mjs --url http://127.0.0.1:4790 \
  --setup --email owner@kilnstreet.test --password '<a throwaway password>' \
  --db /tmp/kiln-street.db --session /tmp/kiln-session.json

# A server that already has a super admin: sign in once, then reuse the saved session.
node apps/e2e/fixtures/own-apps-kiln/build.mjs --url http://127.0.0.1:4790 \
  --email <admin> --password <pw> --session /tmp/kiln-session.json --db /tmp/kiln-street.db
```

- `--db` is the SQLite file. It must be on the server's machine: the script
  creates the file empty, because the SQLite adapter refuses to open a file
  that does not exist. `--replace` starts over on an existing file.
- `--dsn` points at an existing **empty** Postgres or MySQL database instead
  of a SQLite file.
- Signing in is limited to 5 a minute. `--session` keeps the cookies so the
  next run does not sign in again.
- `KILN_EMAIL` and `KILN_PASSWORD` can be used instead of `--email` and
  `--password`.
- A server started with `adminium start` asks for the one-time setup token it
  printed in its log before the first account: pass it with `--setup-token`
  (or `KILN_SETUP_TOKEN`). `smoke.mjs` composes its own server, which asks for
  none.

When it finishes it prints the connection id, the table ids, the row ids and
the ids of the profiles it made.

`buildKiln(options)` in `build.mjs` can also be imported. It returns the same
values plus the signed-in client.

### The add-on

Bundled add-ons are seeded from `ADMINIUM_BUNDLED_ADD_ONS` (default
`./add-ons-bundle`), and a from-source checkout has no such folder. Fill one
with the pinned set and start the server with
`ADMINIUM_BUNDLED_ADD_ONS=<dir>`:

```bash
node scripts/release/fetch-add-ons-bundle.mjs /tmp/add-ons-bundle   # downloads the pinned tarballs
```

The folder needs only `invoices-<version>.tgz` and its `.integrity` file, at
the version pinned in `apps/server/src/add-ons/bundled-pins.ts`. Without it,
step 7 stops and says so. `buildKiln({ addOn: false })` leaves steps 7 and 8
out instead, for a server with no bundled add-ons; `name` gives the
connection another name.

## The smoke

`smoke.mjs` starts the built server itself, using the same composition root as
`adminium start` and `apps/e2e/scripts/e2e-server.mjs`. It uses a fresh data
directory, a fresh SQLite file and no account. It then runs the build through
`--setup` and reads back each piece with GETs:

- the five tables, with their schema changes, rows and pages
- the option list and its binding
- the endpoint, which is saved and answers a server key the smoke mints for itself
- the installed add-on
- the document profile
- the payable profile and its way to pay
- the languages that are on, the French wording, and the French table labels

```bash
E2E_PORT=4790 KILN_ADD_ONS_BUNDLE=/tmp/add-ons-bundle node apps/e2e/fixtures/own-apps-kiln/smoke.mjs
```

Never use port 4610, 4611 or 4612 (the e2e defaults; 4610 is a live server on
the owner's machine). The smoke refuses them. It stops its server in-process,
so there is nothing to kill.

## What the API cannot do (and what the fixture does instead)

- **Create the SQLite file.** No self-host route creates a database file. The
  only one is `POST /desktop/local-database`, which exists only in the desktop
  app. The script writes an empty file next to the server, so it has to run
  on the same machine.
- **Bring in the add-on offline.** Installing reads the server's store, and a
  from-source server stages nothing. The bundle folder above is set up
  outside the API. `POST /add-ons/upload` would need the tarball's bytes
  anyway.
- **Translate an option list's labels or a page title.** Option-list items and
  page titles take one plain string, with no per-locale form. The second
  language therefore reaches table and column labels (per-locale override
  values), edited UI wording (`/i18n/keys`) and the way-to-pay label, and
  nothing else. The way-to-pay label is keyed by language tag (`fr-FR`), while
  everything else is keyed by locale id (`fr_FR`).
