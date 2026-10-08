<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § Pages and their addresses; do not edit -->

# Building an app's screens: Pages and their addresses

A side with more than one page gives each page an address of its own: `/` for the first, `/menu`,
`/menu/spicy-wings`. Then a page can be refreshed, opened in a new tab, sent to somebody and gone
back to, and the dashboard's sidebar can open each screen of a staff side. The side module has
what it takes; there is no router package to add.

```tsx
import { Link, usePath, pathParams, go } from '@adminiumjs/adminium/side';

function Site() {
  const path = usePath();                              // '/', '/menu', '/menu/spicy-wings'
  const item = pathParams('/menu/:slug', path);        // { slug: 'spicy-wings' }, or null
  if (path === '/') return <Home />;
  if (path === '/menu') return <Menu />;
  if (item !== null) return <Item slug={item.slug} />;
  return (
    <main>
      <strong>{en('This page does not exist')}</strong>
      <Link to="/">{en('Back to the first page')}</Link>
    </main>
  );
}
```

- `usePath()` is the page's path under the side, kept current. Call it at the top of the component
  that chooses what to draw, before any `return`. The screen draws again when the path changes.
- `<Link to="/menu">Menu</Link>` is a real link that is followed without loading the side again. It
  takes what an `<a>` takes (`className`, `aria-current`) except `href`.
- `go('/menu')` goes to a page from code: after a form is sent, say. `go(path, { replace: true })`
  puts the new address in place of this one.
- `pathParams(pattern, path)` reads the parts a pattern names with `:`. It gives `{}` for a pattern
  with none, and `null` when the path is another page. Values come decoded.
- `pageHref('/menu')` is the full address of a page, for the rare place that needs it as text.

A path always starts with one `/` and is the same wherever the side is served: at the app's own
address, in a second instance of it, and on a domain mapped to it. So:

- **Never keep the page in a state** (`const [page, setPage] = useState('home')`). Every page is
  then at `/`: a refresh goes back to the first one, and a staff side's second sidebar entry opens
  the first screen.
- **Never write an `href` that starts with `/`.** That address is from the server's root and leaves
  the app. `<Link>` adds where the side is served.
- **Draw the page that does not exist.** Adminium answers the side's own page for any address
  under it, so the screen is the one that knows a path is none of its pages.
- **Name each page**: set `document.title` when the page changes. The browser's tab and history
  show it.

Inside the dashboard, and in a preview, a side changes its address in place, so the browser's Back
leaves the app instead of stepping through its screens. Opened in its own tab, Back steps through
the pages like any site. A staff side keeps the dashboard's sidebar in step by itself: the entry
whose `path` is the page's address is the one shown as open.

The starter screens `adminium app new` writes are two pages each, built this way.
