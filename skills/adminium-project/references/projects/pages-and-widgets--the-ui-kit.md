<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § The UI kit; do not edit -->

# Pages and widgets: The UI kit

Everything comes from `@adminiumjs/adminium/ui`, and is the dashboard's own:
the same look, the same themes and languages.

| | |
|---|---|
| `Page` | The page body; `title`, `description` and `actions` go to the top bar |
| `Card`, `Stack`, `Grid` | Layout: a card with an optional header, a flex column or row, equal columns |
| `Button`, `Input`, `TextArea`, `Select`, `Switch` | Controls; `label`, `hint` and `error` wrap a control in a labelled field. `TextArea` is a box of several lines (`rows`, or `autoResize` to grow with what is typed). With `mentions`, for a column marked `"mentions"`, typing `@` offers the people who sign in; the box is then controlled by `value` and `onValueChange`, which hands back the text to store. `mentionText(stored)` reads such a text back as it was typed (`@Dana Reyes`) |
| `DataTable` | The dashboard's table: `columns` with `type` (`text`, `number`, `money`, `percent`, `date`, `datetime`, `boolean`) or your own `render`, and `rows` |
| `Stat` | A number with a label, and an optional change in percent. It is a card of its own, except on a dashboard card, which already is one. |
| `GeneratedPage` | Renders a page config held in code, such as the one `eject` writes |
| `toast(message, { tone })` | A notification |
| `EmptyState`, `Icon` | An empty state; a Lucide icon by name |
| `Link`, `useNavigate()` | Move to another place in the dashboard, such as `/p/orders` |
| `useCurrentUser()` | `id`, `name`, `email` and `roles` |

### The larger parts

Three parts are code of their own. Each is loaded when the first one is drawn, so a page that uses
none of them pays for none; meanwhile the page shows the place the part will take. Each fits a
phone: a board scrolls sideways inside its own box, and a map's list goes under the map.

```tsx
<Board
  columns={[{ id: 'new', label: 'New' }, { id: 'won', label: 'Won', tone: 'pos' }]}
  cards={deals.map((deal) => ({ id: String(deal.id), title: deal.name, column: deal.stage, figure: money(deal.amount) }))}
  onMove={(cardId, from, to) => save.update(cardId, { stage: to })}
  onOpen={(cardId) => navigate(`/p/deals/r/${cardId}`)}
/>
```

| | |
|---|---|
| `Board` | Cards in columns. `columns` are `{ id, label, tone?, limit? }`; `cards` are `{ id, title, column, tag?, tagTone?, owner?, due?, detail?, figure? }`. A card is moved by dragging it, or with the keyboard (space to pick it up, the arrows, enter). `onMove(cardId, fromColumn, toColumn)` may return the save's promise: when it rejects, the card goes back where it was. |
| `ImportWizard` | The dashboard's import wizard for one table: `database`, `table`, and the `columns` (`{ key, label? }`) a file's columns can be mapped to. What a person may import is decided by their table permissions. |
| `MapView` | A map with a pin for each of `points` (`{ name, lat, lng, value?, id? }`) and a list of them. `onSelect(point)` hands back the one that was picked; `value` sizes a pin, and `valueLabel` says what it counts. Without a network the list still shows. |

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
