<!-- produced from apps/docs/src/content/docs/projects/hooks-and-actions.md § The `db` helper; do not edit -->

# Hooks and actions: The `db` helper

`db.table(name, { database })` reads and writes the way the dashboard does:

| | |
|---|---|
| `get(id)` | One record, or `null` |
| `list({ where, orderBy, limit, offset })` | Records whose columns equal `where`; `orderBy: '-created_at'` sorts descending; 100 by default, 1,000 at most |
| `insert(values)` | The saved record |
| `update(id, values)` | The record after the change, or `null` when there is none |
| `delete(id)` | `true` when a record was deleted |

For a key of several columns, pass the id as an object:
`{ order_id: 7, line: 2 }`.

Its writes run your hooks, go into the audit log under the person behind the
action or change, and start automations. It does not check that person's table
permissions: your action's `permission` is the gate.

`db.raw` is [Kysely](https://kysely.dev) for the same database, and
`db.rawFor('billing')` for another one. Queries made there skip hooks, the
audit log and automations.
