<!-- produced from apps/docs/src/content/docs/projects/hooks-and-actions.md § Actions; do not edit -->

# Hooks and actions: Actions

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
