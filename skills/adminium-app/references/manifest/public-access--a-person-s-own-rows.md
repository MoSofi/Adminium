<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A person's own rows; do not edit -->

# Manifest spec: Public access — A person's own rows

### A person's own rows

An entry with `claim` is its key's **identity**. A caller proves who they are and gets a session on
that row. Each key has at most one identity. A claim takes one of three forms.

**By the row's details**: `{ "match", "verify"?, "email"? }`. The caller proves they know a row's
details (a mobile number and a date of birth).

| Field | Rule |
|---|---|
| `match` | 1–3 columns the caller must match. |
| `verify` | `"email-code"`: the session starts at `lookup`, and a code emailed to the row's own address raises it to `verified`. |
| `email` | With `verify` only: the `text` column holding the address. |

**By a link emailed to the person**: `{ "verify": "email-link", "email" }`. The person types only
their address, and Adminium emails a one-use link (and a code, for another device). The session
opens at `verified` from the link; a typed address alone opens nothing. `email` is the `text`
column holding the address. The entry asks the human check (`"humanCheck": true`), because anyone
can type an address, and every entry its sessions read says `level: "verified"`.

The link opens a page that asks the person to continue and greets them by first name, before
anything is proved. It shows the first word of one column and nothing else: the name the
[outbox](https://docs.adminium.dev/reference/manifest/#outbox)'s `recipient.name` declares, when the recipient lives in the same table; with no
outbox recipient there, the first `text` column in the entry's `select` that is not `email`. It
never reads a number, a date, the address, a masked or secret column, or a column the entry does
not `select`. A declared name the entry does not `select` greets nobody by name, so list it in
`select` (a client portal that shows `["id", "company", "contact_name"]` greets by
`contact_name`, not by `company`).

**By a token**: `{ "by": "token", "column", "expires"?, "stopped"? }`. An unguessable code in a
column opens that one row, with no email at all: a handover page shared by link. `column` is a
`text` column with a [`code`](https://docs.adminium.dev/reference/manifest/#column-rules) rule of length 16, so Adminium fills it. `expires`
is a `date` or `timestamptz` after which the link opens nothing; `stopped` a `bool` that switches
it off. A token opens its row to whoever holds the link, so it is served on a
[key of its own](https://docs.adminium.dev/reference/manifest/#publickeys) that no staff signs in, and every entry on that key only reads
(`GET`) — unless the token is the row's **own link** (`"own": true`, with `address`), which opens a
verified session that may change the row; see [A row's own link](https://docs.adminium.dev/reference/manifest/#a-rows-own-link).

A session opened by a token is checked against the row on every request: once the row is
stopped, past `expires`, or given a new code, the link and every session it opened reach nothing,
at once. Nobody types a code, not staff and not an import. Staff who read the table see the code
and can copy the link: the install says the `column` is no secret, on a table it made (on a table
it reuses, it stays whatever it was). No entry of its table shows it, filters or orders by it — the
one the link opens or any other, under any key — so a `select`, a filter or a `rank` that names the
`column` is refused, and an endpoint or a generated one added later is held to the same. To make a
new link, staff with
`update` on the table call `POST /api/v1/data/<connection>/<table>/<record>/regenerate-code` with
`{ "column": "share_token" }`: a fresh code is written, and the old one never opens anything
again. The answer carries the new code only to a caller who may also read the table.

An entry with `claimedBy` reaches only the claimed person's rows. `table` is the table its key's
identity claims. `column` is a foreign key of this entry's table pointing at it, or that table's
own primary key when the entry is on the identity's table. The column is filled from the session,
so it cannot be `writable`. With `optional: true`, a create goes through with no session at all:
a first visit by someone not yet on file. Only an entry whose `methods` is exactly `["POST"]` may
be optional. An identity takes no `claimedBy`.

```json
"publicAccess": [
  { "table": "patients", "methods": ["GET"], "select": ["name"],
    "claim": { "match": ["mobile", "date_of_birth"], "verify": "email-code", "email": "email" },
    "sensitive": true, "humanCheck": true },
  { "table": "appointments", "methods": ["GET", "PATCH"],
    "claimedBy": { "table": "patients", "column": "patient_id" }, "level": "verified",
    "sensitive": false, "reason": "Times and visit types only, no clinical notes.",
    "select": ["id", "starts_at", "visit_type_id", "clinician_id", "status"],
    "writable": ["status"], "writableValues": { "status": ["cancelled"] },
    "writableWhen": { "status": ["booked"], "starts_at": "from-now" } },
  { "table": "appointments", "methods": ["POST"],
    "claimedBy": { "table": "patients", "column": "patient_id", "optional": true },
    "sensitive": false, "reason": "A new booking answers with its own time only.",
    "select": ["id", "starts_at"],
    "writable": ["starts_at", "visit_type_id", "clinician_id", "new_name", "new_mobile", "new_email"],
    "defaults": { "status": "booked" },
    "humanCheck": true,
    "maxOpen": { "column": "status", "values": ["booked"], "n": 2, "upcoming": "starts_at" },
    "onClaim": { "clear": ["new_name", "new_mobile", "new_email"] },
    "anonymous": { "perValue": { "columns": ["new_mobile", "new_email"], "n": 2 },
                   "perKeyHour": 30, "plainText": ["new_name"] },
    "requireSetting": [{ "table": "settings", "column": "online_booking" },
                       { "table": "settings", "column": "new_patients_online", "when": "anonymous" }] }
]
```

The rules that tie these together:

- **Levels.** An entry with `level: "verified"` refuses a `lookup` session with
  `PUBLIC_CLAIM_LEVEL`, and needs an identity that sends a code or a link. A code is six digits, lasts
  10 minutes and allows 5 tries; a verified session lasts 30 minutes. See
  [The emailed code](https://docs.adminium.dev/guides/apps/public-access/#the-emailed-code).
- **Sensitive rows.** An identity marked `sensitive: true` shows a `lookup` session only its own
  `select`, and must send a code. Every `claimedBy` entry of its key must then say `sensitive`
  either way: `true` needs `level: "verified"`, and `false` needs a `reason`.
- **The address.** Where a claim sends a code, no entry may write the identity's `email` or `match`
  columns or create rows on its table: a session could otherwise send the next code to itself.
  The install refuses such an endpoint.
- **The human check.** A `claimedBy` entry with `humanCheck` needs an identity with `humanCheck`
  too, or claiming first would skip the proof. A found person's own create on an entry with
  `maxOpen` asks no proof. See [The human check](https://docs.adminium.dev/guides/apps/public-access/#the-human-check).
- **`maxOpen`** counts only for a signed-in create, and refuses the next one with
  `PUBLIC_LIMIT_REACHED`.

For the whole flow, see [A person's own rows](https://docs.adminium.dev/guides/apps/public-access/#a-persons-own-rows).
