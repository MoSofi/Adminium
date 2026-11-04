<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-ons; do not edit -->

# Manifest spec: Add-ons

`addOns` names the add-ons an app needs, the ones it works better with, and the features that stop
without one.

```json
"addOns": {
  "requires": [{ "key": "invoices", "range": ">=1.1.0",
                 "reason": { "en-US": "Invoices, quotes and receipts are made by this add-on." } }],
  "suggests": [{ "key": "holiday-calendars", "range": ">=1.1.0", "checked": true,
                 "reason": { "en-US": "Marks public holidays as days off." } }],
  "features": [{ "id": "capacity-holidays", "label": { "en-US": "Holidays in Capacity" },
                 "requires": ["holiday-calendars"] }]
}
```

| Field | Required | Rule |
|---|---|---|
| `requires` | no | 1–8 add-ons the app cannot run without: `{ "key", "range", "reason" }`. |
| `suggests` | no | 1–8 add-ons offered with the app: the same, plus `checked`, whether the offer starts ticked. |
| `features` | no | 1–16 `{ "id", "label", "requires" }`: a part of the app that works only with some add-ons. `id` is kebab-case, up to 40 characters; `requires` lists 1–4 add-on keys, each one the app requires or suggests. |

`key` is an add-on's key. `range` is a semver range over its version (`>=1.1.0`, `^1.1.0`), up to
120 characters. `reason` and `label` are keyed [labels](https://docs.adminium.dev/reference/manifest/#conventions), with `en-US` among them. An
add-on is named once, in `requires` or in `suggests`, and never the app itself.

What each list does:

- **Required.** The install check shows each required add-on, where its version comes from and its
  own install plan. Installing the app installs, updates or connects every required add-on first,
  before the app's own tables, so a table [built on its shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape)
  and a foreign key into its tables resolve. One that cannot be had, or is out of range and not
  ticked to update, refuses the install before anything is written. An add-on an installed app
  requires cannot be removed or switched off: that is refused `409` `ADD_ON_REQUIRED_BY`, naming
  the apps. Nor can it be updated to a version outside the app's `range`: that is refused `409`
  `ADD_ON_RANGE`, and the app is updated first.
- **Suggested.** Offered on the install check, ticked when `checked` says so. The operator may
  leave it out.
- **Features.** A [page](https://docs.adminium.dev/reference/manifest/#pages) that names a feature in `feature` leaves the sidebar while the
  feature's add-ons are not all installed and switched on for the app. A
  [document](https://docs.adminium.dev/reference/manifest/#documents) may name one too, and so may a [part](https://docs.adminium.dev/reference/manifest/#parts) of the app.

If a later step of the app's install fails, the add-ons it installed stay: another app may already
rely on them. Uninstalling the app keeps them too; only their link to the app goes, and the
uninstall preview lists them. Only a required add-on's settings may be read by the app's rules (see
[Values from elsewhere](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere)); a role may be given any named add-on's settings
(see [Roles](https://docs.adminium.dev/reference/manifest/#roles)).

### Binding an add-on to the app's rows

An app binds an add-on from its own side: a column of the app's table links into a table the
add-on keeps ([`addOnLink`](https://docs.adminium.dev/reference/manifest/#column-rules)). The add-on never names a table of the app. An order
line names the shopper's design it was made from, filled only from the design's secret code the
shopper types (a [`lookup`](https://docs.adminium.dev/reference/manifest/#typed-codes) into the add-on's table), never from a key the browser
sends:

```json
{ "ref": "design_code", "type": "text", "maxLength": 40, "nullable": true },
{ "ref": "design_id", "type": "int", "nullable": true,
  "rules": { "addOnLink": { "addOn": "customiser", "table": "designs" },
             "lookup": { "from": "design_code", "table": { "addOn": "customiser", "table": "designs" },
                         "column": "code" } } }
```

A public entry lists `design_code` among a line's `writable` columns, never `design_id`: the link
is Adminium's to fill, so a guest who sends another guest's design key is refused, a code that
finds no design is refused `unknown` and counts as a guess against the visitor's code tries (see
[Typed codes](https://docs.adminium.dev/reference/manifest/#typed-codes)), and the right code, typed however a person types it, links the line.

The line's table is then one that hands the add-on rows, as a [posting](https://docs.adminium.dev/reference/manifest/#postings) or a
[price rule](https://docs.adminium.dev/reference/manifest/#a-price-an-add-on-lowers) makes it: the add-on's pages find it among their tables'
hosts, and a [tab](https://docs.adminium.dev/reference/manifest/#a-tab-on-another-tables-record) declared `"on": "linked"` shows on its records.
An add-on's page reads such a table with the reader's own grant on it, and writes nothing there:
that is how it shows what the app charges for one of its rows (an option row that links to the
add-on's feature and holds its price). Give the app's role `table:@<ref>:read`, limited with
`readable` to the link and the price. See
[Reading an app's prices](https://docs.adminium.dev/guides/add-ons-with-tables/#reading-an-apps-prices).

Two apps may require the same add-on at the same range (`^1.0.0`): both install against one
install of it, and an update of the add-on within the range is never blocked by either. The add-on
keeps the rows of both; its [entries](https://docs.adminium.dev/reference/manifest/#an-add-ons-entry-on-each-apps-key) hold each app's key to
that app's rows.
