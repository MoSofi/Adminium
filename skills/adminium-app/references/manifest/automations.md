<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations; do not edit -->

# Manifest spec: Automations

`automations` lists up to 12 rules an app or an add-on brings with it: "when a stock point falls
to its reorder level, write a request and tell the managers". A rule is written the way the
[rules page](https://docs.adminium.dev/guides/automations/) stores one, a trigger and then a flow of steps. A manifest
that uses it sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"automations": [{
  "key": "low-stock",
  "name": { "en-US": "Tell the managers when stock is low" },
  "enabled": true,
  "trigger": { "kind": "record", "event": "updated", "table": "stock_points", "changedColumn": "state",
               "when": [{ "left": { "field": "state" }, "op": "is", "right": "low" }] },
  "graph": { "version": 1, "nodes": [
    { "id": "t", "kind": "trigger", "title": "A stock point turns low" },
    { "id": "n", "kind": "action", "title": "Tell the managers",
      "action": { "kind": "notification", "to": { "roles": ["manager"] },
                  "title": { "en-US": "{{record.name}} is running low" } } }
  ] }
}]
```

| Field | Rule |
|---|---|
| `key` | kebab-case, up to 80 characters, unique in the manifest. It is how an update finds the rule it shipped before. |
| `name`, `description` | One text, or one per language with `en-US` among them. The install keeps the one the workspace speaks. So for a step's `title` and `sub`, and a notice's `title` and `body`. |
| `enabled` | Whether the rule is switched on when it is first installed. After that the owner's switch stands. |
| `trigger` | `{ "kind": "record", "event", "table", "changedColumn"?, "when"? }` with `event` one of `created`, `updated`, `deleted`; or `{ "kind": "schedule", "schedule", "forEach"? }`. A schedule is `{ "kind": "interval", "everyMinutes" }` (`"5"`, `"10"`, `"15"`, `"30"`, `"60"`) or `daily`, `weekly` (with `dayOfWeek`, 0 = Sunday) or `monthly` (with `dayOfMonth`, 1–28) at a `time` such as `"17:00"`. `forEach` is `{ "table", "where", "once" }`: the rows a run visits. |
| `graph` | `{ "version": 1, "nodes" }`: up to 40 steps with unique ids, the trigger first and only once. A step is a `trigger`, an `action`, a `condition`, a `wait` (up to 30 days), a `stop`, or a `branch` with two branches of up to 20 steps. |

A step's action is one of four:

| `kind` | Keys | What it does |
|---|---|---|
| `notification` | `to: { "roles" }`, `title`, `body`? | Tells everyone who holds one of the manifest's own roles. |
| `email` | `templateKey`, `to: { "kind": "field", "column" }`, `vars`? | Sends one of the manifest's own templates to the address a column of the record holds. |
| `record.create` | `table`, `values` | Adds a row of one of the manifest's tables. |
| `record.update` | `values` | Writes columns of the record. |

A value is a text, which may carry `{{record.<column>}}`, or `{ "now": true }`.

A manifest knows nothing of the install it lands on, so a shipped rule differs from one drawn on
the rules page in three ways:

- Tables are the manifest's own, by their short names. It names no connection and no time zone: a
  rule by the clock runs on the database's zone, else the server's.
- A notice goes to the manifest's own roles and an email to a column of the record: never a fixed
  address, a user, a web address or a document.
- An email's template carries no document and no block marked `withAttachment`, `onlyWith` or
  `onlyWithout`: those are the outbox's.

A condition is `{ "left", "op", "right"? }`. `left` is `{ "field" }`, a column of the record, or
`{ "count": { "table", "matchColumn", "equalsField", "where"? } }`, a count of related rows. On a
yes/no column only `is` and `is_not` are allowed, with `"true"` or `"false"`. A count cannot be
used in a schedule's `forEach.where`: keep the count in a [rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances)
column and compare that. A `changedColumn` that is a total Adminium settles after the save needs
a formula column over it with `"announce": true`. A rule that visits each row `once` needs a
condition that picks the row.

Each rule is installed with the app or add-on and listed on the rules page under "From your
add-ons" or "From your apps". The owner may switch it, test it and copy it; a shipped rule itself
is never edited or deleted there (`409` `AUTOMATION_MANAGED`). An update rewrites a rule nobody
changed, keeping the owner's switch, and removes one the new version no longer ships. While its
add-on is switched off a rule is skipped. Uninstalling removes the shipped rules.
