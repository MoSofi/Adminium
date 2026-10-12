<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Parts; do not edit -->

# Manifest spec: Parts

An app can be cut into **parts** its owner switches on and off: a business that sends no crews out
switches "Jobs on site" off and never sees its pages, its roles or its rules. The screens say
"parts"; the manifest word is `modules`. A manifest that uses it sets
`compatibility.minAdminiumVersion` to `0.3.27` or later. An add-on declares none.

```json
"modules": [
  { "id": "selling", "label": { "en-US": "Selling" },      "default": "always" },
  { "id": "jobs",    "label": { "en-US": "Jobs on site" }, "default": "off" },
  { "id": "quotes",  "label": { "en-US": "Quotes" },       "default": "on", "feature": "quotes" }
]
```

| Field | Required | Rule |
|---|---|---|
| `id` | yes | kebab-case, up to 40 characters, unique in the manifest. |
| `label` | yes | A keyed [label](https://docs.adminium.dev/reference/manifest/#conventions), `en-US` among them. |
| `default` | yes | `on` or `off`: how the part starts; the install check offers it as a tick, and the owner switches it afterwards. `always`: the part has no switch. |
| `feature` | no | One of the app's [`addOns.features`](https://docs.adminium.dev/reference/manifest/#add-ons): the part is also off while that feature's add-ons are not all installed and connected to the app, whatever its switch says. |

1–16 parts. What belongs to a part says so with `"module": "<id>"`: a [table](https://docs.adminium.dev/reference/manifest/#tables), a
[page](https://docs.adminium.dev/reference/manifest/#pages), a rule in [`automations`](https://docs.adminium.dev/reference/manifest/#automations), an entry in [`documents`](https://docs.adminium.dev/reference/manifest/#documents), an
outbox [producer](https://docs.adminium.dev/reference/manifest/#outbox) and a [`publicAccess`](https://docs.adminium.dev/reference/manifest/#public-access) entry each name one part. A
[role](https://docs.adminium.dev/reference/manifest/#roles) names one or several with `"modules": [...]`. Anything that names no part is always
there.

**What "off" means.** While a part is off:

- its pages are out of the sidebar, and their addresses answer `409` `PART_OFF`;
- its rules start no run. A run that was already waiting is passed over, with a line in its log.
  A scheduled rule that visits each row `once` does not use a row up while the part is off;
- its documents are not drawn, its outbox producers queue nothing, its public entries answer as
  entries that are not there, and a scheduled report over one of its pages waits;
- a role whose parts are **all** off gives nothing and is offered to nobody new. Somebody whose
  every role is like that is told "nothing is switched on for you";
- a role that belongs to the part holds **nothing on the part's tables** while it is off.

**What it does not mean.** The tables and their rows stay. A role of *another* part that is
granted one of those tables goes on reading and writing it: an account manager still sees a won
deal's job while "Jobs on site" has no page. So a grant on a table lapses with the table's part
only for a role that is itself of that part.

Switching a part on needs no update and no restart. Nothing that happened while it was off is
caught up: its rules did not run for those changes and do not run for them later. The app's own
screens are told which parts are on (`modules` in their config, `session.modules` from
`connectStaff`), and hide a screen of a part that is off; what such a screen may read is still
decided by the roles.

**A part built on an add-on the app only suggests.** A table
[built on an add-on's shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape) cannot be made without the add-on.
Put it in a part whose `feature` requires that add-on and the app need not require the add-on at
all. Installed without it, the whole part is **left out**: its tables are not made, and what names
them elsewhere goes with them —

- the part's pages, rules, documents, producers and public entries;
- a link column into one of its tables (and an index or a `belongs` way that reads the column);
- a kept total over one of its tables: the column stays, empty, with no rule;
- a page bound to one of its tables, a role's grants and limits on them, a starting row and a
  sample row for them;
- a role left with no part.

When the add-on is connected to the app later, the part is put in: the app is applied again from
its own package, the tables and the link columns are made, and nothing that was there is touched.
A part that is in stays in; switching its add-on off for the app only turns the part off. The
manifest must still be valid with the part left out, and the manifest check tries it: a formula of
another table that reads the link column, for instance, is refused with "installed without
`<add-on>`".
