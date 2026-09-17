---
title: Pages and widgets
description: Write your own pages, table cells and dashboard cards in React, inside a project folder made with `adminium new`.
sidebar:
  order: 6
---

A [project](/projects/) can hold its own browser code:

- **pages**, `pages/<address>.tsx`, which get a place in the sidebar and an
  address, `/p/<address>`, like any generated page;
- **widgets**, `widgets/<name>.tsx`: table cells and dashboard cards that
  page files use by name.

They are React components. `npm run build` bundles them, and `npm run dev`
rebuilds them when you save: open dashboards load the new version.

:::note[Your code runs in the browser of everyone who opens it]
A page's code is served to anyone signed in to Adminium, and the data it reads
goes through Adminium's data API with the permissions of the person looking.
Keep secrets out of it; server-side work belongs in
[hooks and actions](/projects/hooks-and-actions/). The desktop app and
`adminium try` never load project code.
:::

## Pages

```tsx
// pages/revenue.tsx
import { Card, DataTable, Page, definePage, useRecords } from '@adminiumjs/adminium/ui';

export default definePage({
  title: 'Revenue',
  icon: 'chart-line',
  nav: { group: 'library', order: 10 },
  component: function Revenue() {
    const orders = useRecords('main', 'orders', { where: { status: 'paid' }, orderBy: '-placed_at' });
    return (
      <Page description="Paid orders, newest first">
        <Card title="Orders" padded={false}>
          <DataTable
            loading={orders.isLoading}
            rows={orders.data}
            columns={[
              { key: 'id', label: 'Order' },
              { key: 'placed_at', label: 'Placed', type: 'datetime' },
              { key: 'total_amount', label: 'Total', type: 'money' },
            ]}
          />
        </Card>
      </Page>
    );
  },
});
```

The file name is the page's address, so it must be lowercase letters, digits
and dashes, at most 31 characters. A page file and a page of code cannot share
an address: `pages/revenue.json` beside `pages/revenue.tsx` fails the build.

| Option | |
|---|---|
| `title` | The page's name, in the sidebar and the top bar |
| `icon` | A [Lucide](https://lucide.dev/icons/) icon name. Default `file`. |
| `nav.group` | The sidebar group: `workspace` (the default), `library`, `planning`, `people` or `account` |
| `nav.order` | The place in that group. Without it, a new page goes last, and a reorder in Studio sticks. |
| `nav.hidden` | Leave the page out of the sidebar; its address still opens it |
| `component` | The page body. It gets `slug`, the page's address. |

Super admins see every page. Everyone else needs the page's **View** grant in
**Team → Roles**, as for any page; a new page of code starts with the grants the
project's other pages of code have. Studio lists these pages as **Project
code** and does not change them: edit the file instead.

Files whose names start with `_` are not pages, so shared components can live
in `pages/_chart.tsx`.

## Starting from a generated page

To change a generated page beyond what Studio offers, turn its page file into a
page of code:

```bash
npx @adminiumjs/adminium eject orders
```

This writes `pages/orders.tsx` and deletes `pages/orders.json`:

```tsx
import { GeneratedPage, definePage } from '@adminiumjs/adminium/ui';

const page = {
  v: 1,
  kind: 'page',
  template: 'page-crud',
  source: { database: 'main', table: 'main.orders' },
  // … the rest of the page file
};

export default definePage({
  title: 'Orders',
  icon: 'receipt',
  nav: { group: 'library', order: 3 },
  component: function OrdersPage() {
    return <GeneratedPage page={page} />;
  },
});
```

The page looks and works as before, record pages included, and keeps its
address, who can see it and its saved views. Regenerating the database no
longer changes it. From here, edit the settings in `page`, put your own
components around `GeneratedPage`, or replace it.

`GeneratedPage` draws any page config, and a config for the page's own table
also gets that table's record pages and the person's permissions to add,
change and delete its records.

## Widgets

A widget is `project.<file name>`.

### Table cells

```tsx
// widgets/flag-cell.tsx
import { defineWidget } from '@adminiumjs/adminium/ui';

export default defineWidget({
  kind: 'cell',
  component: ({ value }) => (value ? <strong>Flagged</strong> : null),
});
```

A page file uses it on a column:

```json
{ "name": "flagged", "label": "Flagged", "widget": "project.flag-cell" }
```

The component gets `value`, the whole `record`, and `column` (`name` and
`label`). Masked values stay masked: the cell is not drawn for them. A cell
that cannot be drawn, because the widget is missing, is a card, did not load
or threw, shows the plain value with a warning mark.

### Dashboard cards

```tsx
// widgets/sales.tsx
import { Stat, defineWidget } from '@adminiumjs/adminium/ui';

export default defineWidget({
  kind: 'card',
  title: 'Sales',
  component: ({ config, data }) => <Stat label={config.label ?? 'Orders'} value={String(data?.value ?? '—')} />,
});
```

A dashboard page file uses it as a layout item:

```json
{ "i": "sales-1", "widget": "project.sales", "x": 0, "y": 0, "w": 4, "h": 4, "config": { "label": "Today" } }
```

The component gets the item's `config`, and `data`: the result of the item's
`config.binding` when it has one, otherwise `null`. A card that does not load
shows the widget error state with a Retry; the rest of the dashboard keeps
working.

`npm run check` fails when a page file names a widget that does not exist, or
a card where a cell goes.

## The UI kit

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
table permissions, masking and your [hooks](/projects/hooks-and-actions/)
all apply. After a write, every list on the page that shows that database is
read again. `remove` refuses a record other rows refer to unless you pass
`{ confirm: true }`.

## React and other packages

`react`, `react/jsx-runtime` and `react-dom` are the dashboard's own React 19,
so hooks and context work across your code and the kit. `react-dom/client` is
not available: the dashboard renders the page. Other npm packages are bundled
with the page that imports them.

The dashboard's styles do not know your class names. Style with the kit's
components, `style` props, or a CSS file your component imports: it is
bundled and loaded with the page. Images and fonts you import are served with
the build.

Adminium runs the code outside your components once while building, without a
browser, to read `definePage` and `defineWidget`. Keep `window`, `document` and
storage inside components and effects. npm packages are not run then, so a
library that needs the browser when it is imported is fine.

For an editor to check these files, a new project has `@types/react` and a
`tsconfig.json` with `"jsx": "react-jsx"`.

## Building and deploying

`npm run build` writes the pages and widgets to `.adminium/build/client/`: one
file each, plus shared chunks and stylesheets, with a hash of their content in
their names. The server serves them at `/api/v1/project/client/` to signed-in
people, and only as they were built. The dashboard checks each file's
integrity before it runs it, and browsers keep them for good, since a new
build has new names.

In `npm run dev`, saving a page or widget rebuilds it, and every open
dashboard loads the new file and draws it again. The page's state starts over;
there is no hot module replacement.
