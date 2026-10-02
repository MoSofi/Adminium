<!-- produced from apps/docs/src/content/docs/projects/hooks-and-actions.md § Hooks; do not edit -->

# Hooks and actions: Hooks

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
