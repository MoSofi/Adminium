<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § Starting from a generated page; do not edit -->

# Pages and widgets: Starting from a generated page

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
