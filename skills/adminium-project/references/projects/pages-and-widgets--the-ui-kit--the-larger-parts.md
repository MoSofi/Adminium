<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § The UI kit — The larger parts; do not edit -->

# Pages and widgets: The UI kit — The larger parts

### The larger parts

Three parts are code of their own. Each is loaded when the first one is drawn, so a page that uses
none of them pays for none; meanwhile the page shows the place the part will take. Each fits a
phone: a board scrolls sideways inside its own box, and a map's list goes under the map.

```tsx
// The stages are rows of a table, each with a count and a sum of the open deals in it.
const stages = useRecords('main', 'stages', {
  orderBy: 'position',
  measures: [
    { as: 'deals', table: 'deals', via: 'stage_id', fn: 'count', where: { state: 'open' } },
    { as: 'worth', table: 'deals', via: 'stage_id', fn: 'sum', of: 'amount', where: { state: 'open' } },
  ],
});

<Board
  columns={(stages.data ?? []).map((stage) => ({ id: String(stage.id), label: stage.name, count: Number(stage.deals), total: money(stage.worth) }))}
  cards={deals.map((deal) => ({ id: String(deal.id), title: deal.name, column: String(deal.stage_id), figure: money(deal.amount) }))}
  onMove={(cardId, from, to) => save.update(cardId, { stage_id: Number(to) })}
  onOpen={(cardId) => navigate(`/p/deals/r/${cardId}`)}
/>
```

| | |
|---|---|
| `Board` | Cards in columns. `columns` are `{ id, label, tone?, limit?, count?, total? }`; `cards` are `{ id, title, column, tag?, tagTone?, owner?, due?, detail?, figure? }`. A column's header shows how many cards it was given, or its `count` when it has one (a list of cards stops at its limit, so give the whole count), and beside it `total`, a figure already formatted. Both can be read with the columns: `useRecords` takes `measures`, each `{ as, table, via, fn, of?, where? }`, a `count`, `sum` or `avg` over the rows of `table` whose column `via` links to the row, put on the row under `as` and worked out over the rows the person may see. `where` keeps some of those rows: `{ state: 'open' }`, or a list of values a column may hold (`{ kind: ['new', 'renewal'] }`), up to three columns and twenty values each; every column named must hold. A figure whose `where` names a column the person may not read is `null`, and the row's `_masked` lists it. A card is moved by dragging it, or with the keyboard (space to pick it up, the arrows, enter). `onMove(cardId, fromColumn, toColumn)` may return the save's promise: when it rejects, the card goes back where it was and the board shows the rejection's message above its columns. |
| `ImportWizard` | The dashboard's import wizard for one table: `database`, `table`, and the `columns` (`{ key, label? }`) a file's columns can be mapped to. `matchOn` names the column lines are matched on, chosen already, so a line that is already in the table is not added twice (see [Bring in a file](https://docs.adminium.dev/guides/data/bring-in-a-file/)). What a person may import is decided by their table permissions. |
| `MapView` | A map with a pin for each of `points` (`{ name, lat, lng, value?, id?, by? }`) and a list of them, fitted to the points unless `center` or `zoom` says otherwise. `onSelect(point)` hands back the one that was picked; `value` sizes a pin, and `valueLabel` says what it counts. `by` is how a place column says the position is known: a pin `by: 'town'` is drawn hollow and says "by town", and several in one town stand in a ring around it so each can be picked. `onPlace(point, { lat, lng })` turns dragging on (with the keyboard: Enter picks a pin up, the arrow keys move it, Enter keeps the spot, Escape puts it back); save the pair into the place column and it is stored as an exact place. Return the save's promise from it: when the save is refused, or the point has not moved once it settles, the pin goes back. `areas` (`{ id, name?, geometry, tone? }`, a GeoJSON `Polygon` or `MultiPolygon`) are drawn as filled outlines, each with its `name` written on it where the area is large enough on screen to hold it, and `onAreaChange(id, geometry)` turns drawing on: click to add corners, close the shape, drag or remove a corner (`id` is `null` for a new one). A new shape is a `Polygon`; a changed one comes back as the kind it was, a `Polygon` or a `MultiPolygon`, with its holes and its other pieces kept (only the outer ring of the first is changed on the map), so save `geometry` whole. `route` (`{ line?, legs }`, as [`POST /geo/route`](https://docs.adminium.dev/guides/apps/maps/#routes-are-estimates) answers) numbers the points as stops and lists each leg's length in `units` (`'km'` or `'mi'`): "about" for a straight line, "unknown" where there is none to give, with the drive time beside it where the leg has one, and the whole way under the list when every leg has a length. The list shows the first 200 points and then "and n more"; every point has its pin. On a phone each row has "Open in my maps app"; on a desk the picked row has "Open on OpenStreetMap (new tab)", [a plain link](https://docs.adminium.dev/guides/apps/maps/#the-link-out-to-a-maps-app) that carries the position and nothing else. The map is drawn from the install's map server, and only while [maps are on](https://docs.adminium.dev/guides/apps/maps/); with maps off, in the desktop app, or when that server cannot be reached, the list is shown with a line saying which, and "could not be reached" has a "Try again" button. |
