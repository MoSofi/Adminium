<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — An add-on with tables of its own; do not edit -->

# Manifest spec: Add-on manifests — An add-on with tables of its own

A change through the link writes only the columns its entry names, and only while the row holds
one of the values `writableWhen` lists for a column: every such entry names one (an ordered design
is the order's, never the shopper's to change). The column an entry holds to its app
(`appColumn`), the link's own code, its end, its stop and the address it is mailed to are never
written through it, and an `enum` it may set lists its values (`writableValues`). The link makes
no row (`POST`), reaches no row but its own, and a column it does not name is refused `400`. The
human check and a change's `limits` work as on an app's entries. Needs Adminium 0.3.43.

The same entry may also remove its row (`"methods": ["GET", "PATCH", "DELETE"]`): a shopper deletes
their own saved draft (`DELETE /api/v1/public/records/<ref>/<id>`, with the link's session). It is
held to the same `writableWhen` states (an ordered design answers `404`, as a design that is not
there), asks no reason, and reaches no row but its own. The row's files go to the bin as a staff
delete sends them, and a message about it lets go of it (a mailed link stays in the log as sent).
Only an add-on's own link removes a row: `DELETE` on any other entry is refused. Needs Adminium
0.3.43.

#### A row read by its code, by whoever the app signed in

An add-on's entry on each app's key may be read by a session of that app's own sign-in alone
(`level`), and then opens one row by its own code (`unlockBy` with `self`), never a list:

```json
{ "table": "designs", "methods": ["GET"], "select": ["id", "values", "state"], "appColumn": "app",
  "level": "lookup", "unlockBy": { "header": true, "column": "code", "self": true, "length": 16 } }
```

A guest who found their order again reads its lines, each with the code of the design it names
(the app's own entry, read with the order), and opens each design by sending that code in the
`x-adminium-code` header with the session. With no session it is the one `404`; a code no design
of this app has answers an empty list, and counts as a guess. The code is never shown back, and a
shared link's code is never looked up this way. Needs Adminium 0.3.43.

Such a read may show [personal](https://docs.adminium.dev/reference/manifest/#column-rules) columns it selects (a shopper's words on the
design) when the code is 16 characters long (`length: 16`): that is 80 bits of secret, as hard to
find by trying as a shared link's, and whoever holds it holds that one row, as a verified claim
does. A shorter code, or a code of another row that unlocks this one (`unlockBy` without `self`),
shows none: an entry that selects a personal column there is refused where it is written
(`ENDPOINT_PII_NOT_PROVED`). Needs Adminium 0.3.43.

#### Rows that expire

A table of the add-on's own may let its rows go some days after a moment of theirs:

```json
{ "ref": "designs", "expire": { "after": "updated_at", "days": 90,
                                "unless": { "column": "state", "equals": "ordered" } } }
```

| Field | Rule |
|---|---|
| `after` | A `timestamptz` or `date` column of the table: the moment a row's age is counted from. |
| `days` | 1–3650. |
| `unless` | `{ "column", "equals" }`: a row whose column holds the value is kept, however old. An `enum` column's value is one of its values. |

Once a day the server deletes each row whose `after` lies more than `days` days back, its files to
the bin as any deleted row's (its own file columns too). It keeps a row with no `after`, a row an
app's table still names through its link into this table, and a row another row of the database
still points at (tried again the next day). A message about the row never keeps it: a design whose
link was mailed goes on its day all the same, and the message lets go of it (see
[A row that is removed](https://docs.adminium.dev/reference/manifest/#a-row-that-is-removed)). Only an add-on's table says it. Needs Adminium
0.3.43.
