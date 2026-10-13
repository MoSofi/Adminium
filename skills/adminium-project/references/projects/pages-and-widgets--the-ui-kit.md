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
