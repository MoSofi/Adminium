---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/add-on-contracts': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

**Projects: pages and widgets written in React.**

- **Pages.** A project's `pages/<address>.tsx` (`export default definePage({ title, icon, nav,
  component })`) is a page at `/p/<address>`, with a place in the sidebar and the same view grants
  as any page. The server keeps a page row for it (origin `project`); Studio lists it as project
  code and refuses to edit it. A page file and a React page cannot share an address.
- **Widgets.** `widgets/<name>.tsx` (`defineWidget({ kind: 'cell' | 'card', component })`) is
  `project.<name>`: a page file names it on a table column (`"widget"`) or a dashboard layout item.
  A cell that cannot be drawn shows the plain value with a warning mark; a card that does not load
  shows the widget error state. `adminium check` fails on a widget name that does not exist, or a
  card where a cell goes.
- **The UI kit**, `@adminiumjs/adminium/ui`: `Page`, `Card`, `Stack`, `Grid`, `Button`, `Input`,
  `Select`, `Switch`, `DataTable`, `Stat`, `EmptyState`, `Icon`, `Link`, `GeneratedPage`, `toast`,
  and the hooks `useRecords`, `useRecord`, `useMutation`, `useCurrentUser` and `useNavigate`. They
  are the dashboard's own components, and the data hooks go through the data API as the person
  looking.
- **One React.** The dashboard publishes its React, JSX runtime, `react-dom` and the kit on
  `globalThis.__ADMINIUM_ADD_ON_RUNTIME__` (`@adminium/add-on-contracts/runtime`), and a project's
  bundles read them from there, so hooks and context work across project code and the kit.
- **Build and serve.** `adminium build` bundles pages and widgets for the browser into
  `.adminium/build/client/`, with hashed file names; the server serves them to signed-in people at
  `GET /api/v1/project/client/*`, checks each file against the build before sending it, and lists
  them in `GET /api/v1/bootstrap` (`project.client`) with their integrity. `adminium dev` rebuilds
  them on save, and open dashboards load the new files.
- **Studio → Settings → Project** lists the project's pages and widgets.
- **Dashboard:** a page template whose code does not load shows the error card with a Retry
  instead of a skeleton that never ends. The built-in template loaders are a chunk of their own,
  which takes 2.1 KiB gz off the first load. What the dashboard says about a project's code is a
  new, lazily loaded `project` message namespace.
- **`@adminium/widgets`:** table columns take a `widget`, drawn through `CustomCellProvider`; a
  host app's own card widgets resolve through `ExternalWidgetsProvider`, after the registry.
- **The project Dockerfile** copies the whole project folder, without `node_modules`, so `start`
  can tell the build is current.
