<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § The UI kit — Reading and writing records; do not edit -->

# Pages and widgets: The UI kit — Reading and writing records

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
