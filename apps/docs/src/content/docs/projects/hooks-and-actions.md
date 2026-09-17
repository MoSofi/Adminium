---
title: Hooks and actions
description: Run your own code when a record is saved, and add buttons to records that run your code — in a project folder made with `adminium new`.
sidebar:
  order: 5
---

A [project](/projects/) can hold its own server code:

- **hooks**, in `hooks/`, run before or after a record is created, changed or
  deleted;
- **actions**, in `actions/`, are buttons on records that run your code.

Both are TypeScript (or JavaScript) files. `npm run build` bundles them, and
`npm run dev` rebuilds and reloads them when you save, without a restart.

:::caution[Your code runs inside the server]
Hooks and actions run in the Adminium server process with full access to it
and to your databases. Treat them like the rest of your backend code. The
desktop app and `adminium try` never load them.
:::

## Hooks

```ts
// hooks/orders.ts
import { defineHook } from '@adminiumjs/adminium';

export default defineHook({
  table: 'orders', // the database defaults to "main"
  beforeCreate({ values }) {
    values.total = values.qty * values.price;
  },
  beforeDelete({ record, reject }) {
    if (record.status === 'shipped') reject('Shipped orders cannot be deleted.');
  },
  async afterUpdate({ record, before, log }) {
    if (record.status !== before.status) log.info('order status changed', { id: record.id });
  },
});
```

| Option | |
|---|---|
| `table` | The table, such as `orders`, or `sales.orders` outside the default schema |
| `database` | The database key from `adminium.config.ts`. Default `main`. |
| `onImport` | Also run the **after** hooks for rows a CSV import writes |
| `timeout` | `{ before, after }` in milliseconds. Default 5,000 before and 30,000 after. |

| Event | Gets | Runs |
|---|---|---|
| `beforeCreate` | `values` | before a row is added |
| `beforeUpdate` | `values`, `record` | before a row is changed; `values` holds only the columns that change |
| `beforeDelete` | `record` | before a row is deleted |
| `afterCreate` | `record` | after a row is added |
| `afterUpdate` | `record`, `before` | after a row is changed |
| `afterDelete` | `record` | after a row is deleted; `record` is the row as it was |

Every event also gets `db` (below), `log`, `user` (who made the change, or
`null` for the public API), `origin`, `database`, `table` and `signal`, which
is aborted when the hook runs out of time. `origin` says where the change came
from: `dashboard`, `bulk`, `undo`, `public`, `automation`, `import`, `hook` or
`action`.

### Before a change

A before hook can change `values`: what it leaves there is saved. Setting a
column the table does not have stops the change.

`reject(message)` stops the change, and the person who made it sees your
message. That works everywhere a record is written: a single edit, a bulk edit,
an undo, the public API (as the error code `PUBLIC_WRITE_REJECTED`), an
automation step and a CSV import, where the row lands in the error report. A
bulk edit that a hook rejects for one row saves none of them.

A before hook that throws, or runs past its time limit, stops the change too.
The person sees that a project hook failed; the error goes to the server log
and to **Studio → Settings → Project**.

### After a change

After hooks run once the change is saved. An error in one is logged and shown
in **Studio → Settings → Project**, and never undoes the change.

A CSV import is one action, not thousands of changes, so after hooks skip its
rows unless the hook sets `onImport: true`. Before hooks always run.

### Order and loops

Several hooks on one table run in file-name order.

A hook can write through `db`, and those writes run hooks too. Each nested
write counts one step, and after three Adminium stops the chain, so two hooks
that update each other's tables cannot loop forever.

## Actions

```ts
// actions/refund-order.ts
import { defineAction } from '@adminiumjs/adminium';

export default defineAction({
  table: 'orders',
  label: 'Refund',
  icon: 'undo-2',
  confirm: 'Refund this order?',
  async run({ record, db, fail }) {
    if (record.status !== 'paid') fail('Only paid orders can be refunded.');
    await db.table('orders').update(record.id, { status: 'refunded' });
    return { message: 'Order refunded.' };
  },
});
```

The file name is the action's id, so use lowercase letters, digits and dashes.

| Option | |
|---|---|
| `table` | The table whose records get the button |
| `label` | The button's text |
| `database` | The database key. Default `main`. |
| `icon` | A [Lucide](https://lucide.dev/icons/) icon name |
| `confirm` | A question asked before the action runs |
| `permission` | The table permission a person needs: `read`, `create`, `update` (the default) or `delete` |
| `bulk` | Also offer the action on several selected rows |
| `timeout` | Milliseconds. Default 60,000. |

The button shows on the record page, in each row's **Actions** menu, and, with
`bulk`, in the bar that appears when rows are selected. Only people with the
permission see it.

When someone clicks it, Adminium checks the permission again, reads the
selected rows the way that person sees them (masked columns stay masked), and
calls `run` with `record` (the first row), `records` (all of them), `db`,
`log`, `user` and `signal`. `fail(message)` stops the action with a message for
that person; changes it already made stay. `run` may return:

| | |
|---|---|
| `message` | Shown to the person who clicked |
| `refresh` | Reload the page's data afterwards. Default `true`. |

Every run is written to the audit log as `project.action`, with the records and
the outcome. Labels, questions and messages are your own text and are not
translated.

## The `db` helper

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

## Building and deploying

`npm run build` bundles each file in `hooks/` and `actions/` with the npm
packages it imports into `.adminium/build/server/`. Files whose names start
with `_` are not hooks or actions, so shared code can live in
`hooks/_shared.ts`. `npm run check` loads the built files the way the server
does and names any that would not load.

Packages with native code, such as database drivers, are not bundled. They
stay imports, so they must be installed where the server runs. The project's
Docker image copies the project folder without its `node_modules`, so keep
them out of hooks and actions that you deploy that way.

On a server, a file that fails to load is skipped and listed in **Studio →
Settings → Project**; the rest keep working. How to get the project onto a
server at all: [Deploy a project](/projects/deploy/).
