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
  [document](https://docs.adminium.dev/reference/manifest/#documents) may name one too.

If a later step of the app's install fails, the add-ons it installed stay: another app may already
rely on them. Uninstalling the app keeps them too; only their link to the app goes, and the
uninstall preview lists them. Only a required add-on's settings may be read by the app's rules (see
[Values from elsewhere](https://docs.adminium.dev/reference/manifest/#values-from-elsewhere)); a role may be given any named add-on's settings
(see [Roles](https://docs.adminium.dev/reference/manifest/#roles)).
