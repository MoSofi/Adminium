<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § The UI kit; do not edit -->

# Pages and widgets: The UI kit

Everything comes from `@adminiumjs/adminium/ui`, and is the dashboard's own:
the same look, the same themes and languages.

| | |
|---|---|
| `Page` | The page body; `title`, `description` and `actions` go to the top bar |
| `Card`, `Stack`, `Grid` | Layout: a card with an optional header, a flex column or row, equal columns |
| `Button`, `Input`, `Select`, `Switch` | Controls; `label`, `hint` and `error` wrap a control in a labelled field |
| `DataTable` | The dashboard's table: `columns` with `type` (`text`, `number`, `money`, `percent`, `date`, `datetime`, `boolean`) or your own `render`, and `rows` |
| `Stat` | A number with a label, and an optional change in percent. It is a card of its own, except on a dashboard card, which already is one. |
| `GeneratedPage` | Renders a page config held in code, such as the one `eject` writes |
| `toast(message, { tone })` | A notification |
| `EmptyState`, `Icon` | An empty state; a Lucide icon by name |
| `Link`, `useNavigate()` | Move to another place in the dashboard, such as `/p/orders` |
| `useCurrentUser()` | `id`, `name`, `email` and `roles` |

### Reading and writing records

```tsx
const orders = useRecords('main', 'orders', { where: { status: 'paid' }, orderBy: '-placed_at', limit: 20 });
const order = useRecord('main', 'orders', 7);
const save = useMutation('main', 'orders');
await save.update(7, { status: 'refunded' });
```

The first argument is the database key from `adminium.config.ts`, the second
the table, such as `orders` or `sales.orders` outside the default schema.

| | |
|---|---|
| `useRecords(db, table, query)` | `data`, `total` (when the database can count cheaply, otherwise `null`), `isLoading`, `error` and `refetch`. `query` takes `where` (columns equal to values), `search`, `orderBy` (`-` for descending), `limit` (50 by default, 200 at most) and `offset`. |
| `useRecord(db, table, id)` | `data` is the record, or `null` when there is none |
| `useMutation(db, table)` | `create(values)`, `update(id, values)`, `remove(id)`, `isPending` and `error` |

They go through the same API as generated pages, as the person looking: their
table permissions, masking and your [hooks](https://docs.adminium.dev/projects/hooks-and-actions/)
all apply. After a write, every list on the page that shows that database is
read again. `remove` refuses a record other rows refer to unless you pass
`{ confirm: true }`.
