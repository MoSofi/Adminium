<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § Pages become addresses; do not edit -->

# A website template as a working app: Pages become addresses

Each `.html` page is a page of the side at an address of its own: `index.html` is `/`, `shop.html`
is `/shop`. `App.tsx` reads the address with `usePath()` and draws that page, as
[pages and their addresses](https://docs.adminium.dev/guides/apps/building-a-side/#pages-and-their-addresses) says, sets
`document.title` from the page's own `<title>`, and draws a "this page does not exist" page in the
template's markup for any other address.

The header and the footer are written once, in `parts/`, and every page shows them. **Compare every
page's copy of a shared block before making it one part.** Templates differ in small ways from
page to page: in the furniture template the testimonial section has the class
`before-footer-section` on three pages and not on the home page, which changes the space below
it. Carry such a difference as a prop of the part.

Turning the markup into JSX, element for element:

| In the template | In the screen |
|---|---|
| `class`, `for`, `tabindex`, `maxlength`, `colspan` | `className`, `htmlFor`, `tabIndex`, `maxLength`, `colSpan` |
| `style="max-width: 120px"` | `style={{ maxWidth: '120px' }}` |
| `<img>`, `<input>`, `<br>` | closed: `<img />` |
| `<!-- … -->` | `{/* … */}`, or left out |
| `fill-rule`, `stroke-width` on an SVG | `fillRule`, `strokeWidth` |
| `value` and `checked` on an input | `defaultValue`, `defaultChecked` (or the screen's state) |
| An entity of HTML5 only, such as `&plus;` | the character itself (`+`): JSX shows such an entity as typed |
| `<a href="shop.html">` | `<Link to="/shop">` from `@adminiumjs/adminium/side` |
| `<img src="images/couch.png">` | `import couch from '../site/images/couch.png'`, then `src={couch}` |
| `<script>document.write(new Date().getFullYear())</script>` | `{new Date().getFullYear()}` |
| `onclick="window.location='checkout.html'"` | `onClick={() => go('/checkout')}` |
| `<thead><th>` with no `<tr>` | add the `<tr>` the browser added |

Three things a browser forgives and JSX does not:

- **A closing tag too many.** The browser drops it; JSX fails to build. Count the `<div>`s of each
  section, and drop the extra one where the browser would.
- **Two pictures whose names differ only in a mark**, `person-1.png` and `person_1.jpg`. Give each
  import its own name, or one picture shows in the other's place.
- **A misspelt attribute** (`clsas`, `hreff`). It does nothing in the template; keep it doing
  nothing, so the look stays the same. Do not fix it into a class or a link the template never had.

The template's words stay as it wrote them, in the markup: they are the person's text, placeholder
or not, and the dashboard is where they are changed once they are rows. Wrap in `en('…')` only the
sentences you add (loading, a refusal, what happens after sending).

A link the template leaves empty (`href="#"`) stays as it is and goes into the
[feature report](https://docs.adminium.dev/guides/apps/from-a-template/#the-feature-report-before-the-build): where it should lead is the person's to
say. A link whose target is plain (a "Shop now" button to the shop page) is linked.
