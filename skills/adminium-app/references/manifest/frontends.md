<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Frontends; do not edit -->

# Manifest spec: Frontends

`frontends` declares the app's own screens: a **staff** side, a **customer** side, a **mobile**
side (a phone app), or any of them together. At least one is required, and each side may appear
once. The Adminium dashboard itself is always
there and is not declared.

```json
"frontends": [
  { "side": "staff", "kind": "spa", "entry": "index.html",
    "routes": { "pos": "/" }, "placement": "external" },
  { "side": "customer", "kind": "spa", "entry": "index.html",
    "routes": { "book": "/", "manage": "/manage" } }
]
```

| Field | Required | Rule |
|---|---|---|
| `side` | yes | `staff`, `customer` or `mobile`. |
| `kind` | yes | `spa`, `electron` or `none`; `expo` for the `mobile` side, and for it alone. |
| `entry` | no | The frontend's entry file (`index.html`). |
| `env` | no | The environment variables the frontend reads, each `{ "required": boolean, "example"?: string }`. |
| `routes` | no | The views this side owns, from a view name to a path. |
| `placement` | no | Staff side only: `internal` opens the screens inside the dashboard, `external` on their own address (a till). The operator can change it. Absent means `internal`. |
| `enabled` | no | Whether the side starts switched on. Absent means on. |
| `records` | no | Staff side only: where a record opens on this side, from a table ref to a path with one `{id}`; see [Where a record opens](https://docs.adminium.dev/reference/manifest/#where-a-record-opens). Needs Adminium 0.3.28. |

### Where a record opens

Adminium gives people links to records: a notice in the bell, the button of the notice's email, a
search hit. Each opens the dashboard's record page. An app whose staff side has a screen of its
own for a record says where, per table:

```json
{ "side": "staff", "kind": "spa", "entry": "index.html", "placement": "external",
  "records": { "deals": "/deals/{id}", "quotes": "/quotes/{id}", "companies": "/companies/{id}" } }
```

Each key is one of the app's table refs. Each value is a path under the side: `/`, then plain
segments (letters, digits, `.`, `_`, `~`, `-`), and `{id}` as one whole segment, exactly once. It
has no query, no `#`, no `..` and no host: the address can only be a screen of this side. `{id}`
is the record's key as the dashboard's record page takes it (a key of several columns is their
values as a JSON list), written as one segment whatever it holds.

Who gets the app's address is decided for each person. Somebody whose roles open the staff side
(`app:@:staff`) gets it, while the app is on, the side is switched on and the table's part is on.
Everybody else keeps the dashboard's record page. Then:

- **A notice** (`GET /api/v1/me/notifications`) carries the address in `actionUrl`
  (`/apps/<key>/staff/deals/12`; `/a/<key>/deals/12` for a side shown inside the dashboard) and
  `opens: { "appKey", "path" }` with the path under the side (`/deals/12`), which the app's own
  screens route on. It is asked again each time the list is read, so a role given or taken later
  moves a notice already written.
- **The notice's email** carries the same address in its button: on the host mapped to the staff
  side when there is one, else under the server's public address.
- **A search hit** (`GET /api/v1/search`) carries `opens: { "appKey", "path", "url" }`. A table
  with an address is searched for somebody who reads it and opens the staff side, even with no
  page of the dashboard to land on; `pageSlug` is then empty.

Somebody who is signed out and follows the address is sent to sign in and brought back to it. The
way back is followed only to a path of the same address, and on the dashboard's own address only
into an app's screens. Only the staff side takes `records`. A table left out with its part takes
its address with it.

A `mobile` side is `{ "side": "mobile", "kind": "expo" }` and nothing more: it is a phone app in
`apps/<key>/mobile/`, which Adminium serves to nobody and no package carries, so it has no entry,
routes, placement or switch. What it has is a key of its own kind for the public API, made at
install beside the customer key: see [A phone app for an app](https://docs.adminium.dev/guides/apps/phone-app/). A
manifest with a `mobile` side needs the Adminium that knows it or a newer one
(`compatibility.minAdminiumVersion`); an older one refuses the whole manifest.

Adminium serves each web side at `/apps/<key>/<side>/`. The staff side needs a signed-in user; the
customer side is public and calls the [public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/) with the
app's `customer` browser key, which the install creates. A staff side can be handed a second key
for a screen of its own; see [publicKeys](https://docs.adminium.dev/reference/manifest/#publickeys). Each side reads its `surface-config.json` at boot: the real table
names, the app's settings and, for the staff side, the connection, the venue's time zone and
currency, who is signed in, the language they chose in Adminium (`locale`, as a tag such as
`ar-EG`, with its `dir`), and `access`: which of `read`, `create`, `update` and `delete` they
hold on each of the app's tables, and the app's roles they hold. A staff screen uses it to leave
out a button whose write would be refused; the data API still checks every write. The staff
side's config also carries `kit`, the address of Adminium's own larger parts for a screen that
draws one itself (see [Adminium's own parts on an app's screen](https://docs.adminium.dev/guides/apps/kit-parts/)), and
`maps`: whether maps are on, the map server's address, and whether routes along roads are on.
