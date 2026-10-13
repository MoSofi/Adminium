<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations; do not edit -->

# Manifest spec: Automations

`automations` lists up to 24 rules (more than 12 needs `minAdminiumVersion` `0.3.28`) an app or an add-on brings with it: "when a stock point falls
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
| `module` | Optional. The [part](https://docs.adminium.dev/reference/manifest/#parts) of the app the rule belongs to: it starts no run while that part is off. Needs Adminium 0.3.28. |
| `graph` | `{ "version": 1, "nodes" }`: up to 40 steps with unique ids, the trigger first and only once. A step is a `trigger`, an `action`, a `condition`, a `wait` (up to 30 days), a `stop`, or a `branch` with two branches of up to 20 steps. |

A step's action is one of six:

| `kind` | Keys | What it does |
|---|---|---|
| `notification` | `to: { "roles" }` or `to: { "column" }`, `title`, `body`?, `urgent`? | Tells everyone who holds one of the manifest's own roles, or [the person on the row](https://docs.adminium.dev/reference/manifest/#the-person-on-the-row). `"urgent": true` tells them at once, also in their quiet hours. |
| `email` | `templateKey`, `to: { "kind": "field", "column" }` or `to: { "kind": "staff", "column" }`, `vars`? | Sends one of the manifest's own templates to the address a column of the record holds, or to [the person on the row](https://docs.adminium.dev/reference/manifest/#the-person-on-the-row). |
| `digest` | `templateKey`, `to: { "roles" }`, `sections`, `sendEmpty`? | Makes [a summary for each person](https://docs.adminium.dev/reference/manifest/#a-summary-for-each-person) who holds one of the roles: their own rows, read as they read. |
| `record.create` | `table`, `values`, `name`? | Adds a row of one of the manifest's tables. With a `name`, [the steps after it read the row it made](https://docs.adminium.dev/reference/manifest/#a-row-a-step-makes). |
| `record.update` | `values` | Writes columns of the record. |
| `add-on.step` | `addOn`, `step`, `inputs` | Runs a [step an add-on gives](https://docs.adminium.dev/reference/manifest/#steps-for-automations): the add-on's key, the step's key, and a text for each input. An add-on's own step is checked here; another add-on's is checked where the rule is installed, and fails by name while that add-on is not there. Needs `minAdminiumVersion` `0.3.22`. |

A value is a text, which may carry `{{record.<column>}}`, or `{ "now": true }`.
