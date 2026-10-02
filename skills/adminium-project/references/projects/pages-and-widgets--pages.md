<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § Pages; do not edit -->

# Pages and widgets: Pages

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

Super admins see every page, and so do the built-in Admin, Editor and Viewer
roles unless someone takes it away: **People → Roles & permissions → See every
page**. A role without that row needs a **View** grant on the page itself, which
is set through the roles API (`PUT /api/v1/roles/{id}/permissions`), as for any
page; a new page of code starts with the grants the project's other pages of
code have. Studio lists these pages as **Project code** and does not change
them: edit the file instead.

Files whose names start with `_` are not pages, so shared components can live
in `pages/_chart.tsx`.
