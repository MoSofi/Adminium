<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § Widgets; do not edit -->

# Pages and widgets: Widgets

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
