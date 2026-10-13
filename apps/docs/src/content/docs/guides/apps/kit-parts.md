---
title: Adminium's own parts on an app's screen
description: "Draw one of Adminium's larger parts, the text box that mentions people, the board, the map or the import wizard, inside a screen your app wrote itself: the address in the side's config, the mount call, the props, what your screen saves and what the part does, the look, and what a person who opens only your screens gets."
---

A staff side is a bundle of its own: its own React, or none. Some parts are too large to write
again in every app, and should behave the same everywhere: the text box in which people are
mentioned, the board, the map, the import. Adminium serves these itself, and a screen asks for one
with a small call: "draw it in this element". The part is drawn by Adminium's own React. Yours
never meets it, so a screen written in plain JavaScript can use a part as well as one in React.

Four parts can be mounted: **the mention text area** (`mentions`), **the board** (`board`), **the
map** (`map`) and **the import wizard** (`import`). `kit.parts` lists the ones this Adminium can
mount: an older Adminium has fewer, and refuses one it names and has not built yet with an error
whose `code` is `KIT_PART_NOT_YET`.

This is for a **staff side**. A customer side is told nothing of the kit, and a customer address
refuses its files.

## Where the kit is

The staff side's `surface-config.json` names it:

```json
{
  "kit": {
    "contract": 1,
    "entry": "/assets/kit/kit-BHhBq5nz.js",
    "styles": ["/assets/kit/root-DF31DXoR.css", "/assets/kit/board-Cq0vLx2A.css", "/assets/kit/import-CGzukXkN.css", "/assets/kit/map-DjqTAZ9Z.css"]
  },
  "maps": { "enabled": true, "server": "https://tiles.openfreemap.org", "routing": false },
  "locale": "ar-EG",
  "dir": "rtl"
}
```

| | |
|---|---|
| `kit.entry` | The file to import. Its name changes with every version of Adminium, so read it from the config each time the page loads and never write it into your code. |
| `kit.contract` | The number of the mount call's contract. This page describes contract `1`. If your screen was written for another number, show the part's place as unavailable instead of calling it. |
| `kit.styles` | Every stylesheet of the kit, as a list: the one all parts stand on first, then one for each part that has its own. The kit loads what a part needs when it is mounted; the list is only for a page that wants them fetched early. It may be empty. |
| `maps` | Whether maps are on in this Adminium, the map server's address, and whether routes along roads are on. The same answer the dashboard gets. Hand it to the map part as it came, as its `maps`. |
| `locale`, `dir` | The language the signed-in person chose in Adminium and its direction. Hand both to every part. |

`kit` is absent when this Adminium has no kit (it runs without the dashboard, or is older than the
kit). Check for it, and leave the part's place empty or say it is not available.

The address is the same whether the side is opened at `/apps/<key>/staff/`, as an extra instance,
or on a staff address of its own.

## Mounting a part

```ts
const config = await (await fetch('surface-config.json', { credentials: 'same-origin' })).json();
if (config.kit?.contract !== 1) throw new Error('This Adminium has no kit this screen can use.');

const kit = await import(/* @vite-ignore */ config.kit.entry);

const box = await kit.mount('mentions', document.querySelector('#comment'), {
  value: '',
  onChange: (stored) => { draft = stored; },
  label: 'Comment',
  locale: config.locale,
  dir: config.dir,
});

box.update({ value: '' });   // change some props; the others stay
box.unmount();               // take the part away
```

`mount(part, element, props)` resolves once the part is in the page, with `{ update, unmount }`.

- **`update(props)`** changes the props you name and keeps the rest. The box, its focus and the
  caret stay where they are, so it is safe to call while the person is typing.
- **`unmount()`** removes the part and leaves the element empty. Call it when your screen removes
  the element.

The import is of an address known only when the page runs, so tell your bundler to leave it alone
(`/* @vite-ignore */` for Vite, `/* webpackIgnore: true */` for webpack). In React, mount in an
effect and unmount in its clean-up:

```tsx
function Comment({ config, onChange }: { config: SideConfig; onChange: (stored: string) => void }) {
  const place = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let box: { unmount(): void } | undefined;
    let gone = false;
    void import(/* @vite-ignore */ config.kit.entry)
      .then((kit) => kit.mount('mentions', place.current, { value: '', onChange, locale: config.locale, dir: config.dir, label: 'Comment' }))
      .then((mounted) => (gone ? mounted.unmount() : (box = mounted)));
    return () => {
      gone = true;
      box?.unmount();
    };
  }, [config]);
  return <div ref={place} />;
}
```

## The mention text area

A text box in which typing `@` and a letter or two offers people under the box. The arrow keys
move through them; Enter, Tab or a click takes one; Escape puts the list away.

The box shows `@Dana Reyes`. What it hands to `onChange`, and what you store, is
`@[Dana Reyes](usr_…)`: the name as it read when it was written, and the person's id. This is the
same form the dashboard's own box stores, so a comment written on your screen reads right in the
dashboard and the other way round. Hand a stored text back as `value` and the box shows the names.

| Prop | |
|---|---|
| `value` | The text as it is stored. Required. |
| `onChange(stored)` | Called on every change with the text to store. Required. |
| `locale`, `dir` | From the side's config. Required. A language the kit does not have reads as English. |
| `label` | Drawn above the box and tied to it. |
| `ariaLabel` | The box's name for a screen reader when there is no `label`. Give one of the two. |
| `placeholder` | |
| `rows` | Default 3. |
| `disabled` | |
| `invalid` | Draws the box as wrong and says so to a screen reader. |
| `people(query)` | Who may be named: a function from what was typed to a promise of `{ id, name }[]`. Left out, the people who sign in to this Adminium, found by name. |
| `theme` | `light` or `dark`, for an app with no colour values of its own. Left out, the box follows the page. |

The box keeps what was typed. You hear every change through `onChange` and do not have to hand
the value back. Call `update({ value })` only to replace the text, for example to empty the box
after a save.

### Who is offered

With no `people` of your own, the box asks `GET /api/v1/people` with the signed-in person's own
session: up to eight people whose name holds what was typed.

**A person whose roles open only your app's screens may not read that list.** For them the box
offers nobody and is a plain text box: typing works, an `@name` they type is stored as they typed
it, and nobody is told. The box asks once and not again until the page is loaded again. If such
people must mention others, pass a `people` function that reads names from a table of your own
that their role may read (a table of staff members with a `user_id`), and answer
`{ id: user_id, name }` for each.

## The board

Columns of cards. A person moves a card to another column by dragging it with a mouse or a
finger, or with the keyboard: Tab to a card, Enter or space to pick it up, the left and right
arrows to carry it to the next column, Enter to drop it, Escape to put it back. Each step is said
to a screen reader. It is the dashboard's own board, so it behaves the same there and here.

Your screen owns the rows. It reads them, hands them over as plain data, and saves a move. Here
`staff` is the session of [a staff side](/guides/apps/building-a-side/#a-staff-side):

```ts
async function read() {
  const { rows } = await staff.list('deals', { order: 'id.asc', limit: 200 });
  return {
    columns: STAGES.map((stage) => ({ id: stage.id, label: stage.label, tone: stage.tone })),
    cards: rows.map((row) => ({
      id: String(row.id),
      columnId: String(row.stage),
      title: String(row.title),
      subtitle: String(row.company),
      amount: money.format(Number(row.amount)),   // written as text by you
      lines: [{ label: 'Close', value: day.format(new Date(String(row.close_on))) }],
      owner: String(row.owner_name),
    })),
  };
}

const board = await kit.mount('board', document.querySelector('#pipeline'), {
  ...(await read()),
  locale: config.locale,
  dir: config.dir,
  ariaLabel: 'Pipeline',
  canMove: staff.can('deals', 'update'),
  onOpen: (cardId) => router.go(`/deals/${cardId}`),
  onMove: async (cardId, toColumnId) => {
    await staff.update('deals', cardId, { stage: toColumnId });   // a refusal throws, with the server's sentence
    board.update(await read());                                    // new counts, and whatever else the save changed
  },
});
```

A screen with no staff session does the same with `fetch` against the data API and answers
`{ refused: reply.error.message }` when the reply is not a success.

### Props

| Prop | |
|---|---|
| `columns` | The columns, in order. Required. Each: `id`, `label`, and optionally `tone` (`neutral`, `accent`, `pos`, `warn`, `danger`, `info`: the dot before the heading), `badge` (a few quiet characters right after the heading, as text: a stage's odds, "10%"), `count` (how many cards the column holds in all; left out, the number of cards given), `total` (a figure at the heading's far end, as text), `limit` (the count reads "4/3" and turns red above it). |
| `cards` | The cards. Required. Each: `id` (the row's key, as text), `columnId`, `title`, and optionally `subtitle`, `amount`, `meta`, `lines`, `tag`, `tagTone`, `owner`, `due`, `progress`, `reference`, `actions` (below). A card whose `columnId` is not a column's `id` is not drawn. Within a column the cards stand in the order given. |
| `locale`, `dir` | From the side's config. Required. |
| `onMove(cardId, toColumnId, fromColumnId)` | Saves a move. Left out, no card can be moved. |
| `canMove` | `false`: no card moves. A function from a card's id to yes or no: only those do. Left out, every card (when there is an `onMove`). |
| `onOpen(cardId)` | Called on a click. By keyboard: Enter on a card that cannot be moved, and Shift+Enter on one that can (Enter alone picks it up). |
| `onAction(cardId, actionId)` | Called when one of a card's own `actions` is chosen. Left out, no card has a menu. |
| `onAdd(columnId, title)` | Saves a new card typed at a column's foot. Left out, there is no "Add card". |
| `busy` | Your screen is reading: said to a screen reader, drawn dimmed, and nothing moves meanwhile. |
| `emptyLabel` | A line above the columns while there is no card, and in place of the board while there is no column. |
| `ariaLabel` | The board's name for a screen reader. |
| `theme` | `light` or `dark`, as for every part. |

What a card can show, all of it text you have already written in the reader's language:

| | |
|---|---|
| `title` | The bold line. Also the card's name for a screen reader. |
| `subtitle`, `amount` | A quiet line under the title, and a figure at its far end. |
| `meta` | Short lines with no label ("3 days in stage"). |
| `lines` | Labelled lines: `{ label: 'Close', value: '12 Mar' }`. |
| `tag`, `tagTone` | A small pill above the title; its tone defaults to the column's. |
| `owner` | A person's name, drawn as initials in a small round. |
| `due` | A chip at the foot. |
| `progress` | 0 to 100, drawn as a bar. |
| `reference` | Small print at the foot, such as "D-1042". Left out, nothing: the row's key is not shown. |
| `actions` | The card's own menu (below). |

### A card's own actions

Give a card `actions` and the board an `onAction`, and the card gets a small "more" button at its
far corner that opens them as a menu:

```ts
cards: rows.map((row) => ({
  id: String(row.id),
  columnId: String(row.stage),
  title: String(row.title),
  actions: [
    { id: 'close', label: 'Close: won or lost…' },
    { id: 'room', label: 'Open the deal room' },
    { id: 'hand', label: 'Hand it over…', disabled: !staff.can('deals', 'update') },
    { id: 'delete', label: 'Delete', tone: 'danger' },
  ],
})),
onAction: (cardId, actionId) => {
  if (actionId === 'close') openCloseDialog(cardId);
},
```

Each action is `id`, `label` (in the reader's language), and optionally `tone: 'danger'` (drawn in
red, for what cannot be taken back) and `disabled` (listed, said as unavailable, and a press does
nothing). The board draws the menu and tells you what was chosen; what the action does is yours.

The button is named "Actions for" and the card's title. It comes after the card in the Tab order,
and it is not part of the card: pressing or dragging it never picks the card up. In the menu the
arrows go from item to item, Home and End to the first and the last, Enter or space choose, and
Escape closes it and gives the focus back to the button. A press anywhere else closes it. The menu
is not cut off by its column: it is drawn over the page, under the button where there is room and
above it where there is none, and scrolling the board puts it away.

So that a keyboard reaches everything on a card that can be moved: Enter or space picks the card
up, **Shift+Enter opens it** (`onOpen`), and Tab goes on to its menu. A screen reader is told the
first two on the card itself. If opening matters on your screen, an `actions` item that opens the
card is easier to find than a key; the board adds none of its own.

### What `onMove` must answer

The board draws the card in its new column at once and then calls `onMove`. Answer a promise:

- **resolved with nothing**: the move held. The card stays.
- **resolved with `{ refused: 'the reason' }`**, or **rejected** with an error: the card goes back
  where it was, the reason is shown in a line above the columns and said to a screen reader, and
  the keyboard focus returns to the card. Hand over the server's own sentence
  (`error.message` of the reply); it is written for a person.

If `onMove` answers nothing at all (no promise), the move is taken as saved.

`fromColumnId` is the column the card left. When the table keeps states, send it with the save
as the state the person saw (`from` in the data API's change): the server then refuses a move of a
card somebody else has already moved, and the person is told.

`onAdd` answers the same way. A refused add keeps the typed title in its box, to be corrected or
sent again, and says why in the same line.

### Who does what

Your screen:

- reads the rows with the signed-in person's session, so they see the cards their role may read
  and nothing else;
- decides the columns and their order, and which cards a person may move (`canMove`; use the
  session's `can('deals', 'update')`);
- writes every figure and date as text: the board prints what it is given and formats nothing;
- saves the move, and after a save that held calls `update` with the rows read again when it
  shows counts, totals or anything the server may have changed with the move.

The kit:

- draws the board, the drag, the keyboard move and its announcements, in the person's language
  and direction;
- keeps a move that held, so the card stays put even if you hand nothing back, and puts back one
  that was refused;
- scrolls its columns sideways inside its own box on a narrow screen, and follows a card carried
  by keyboard to a column that was out of sight. The page itself never scrolls sideways.

`update(props)` replaces `cards` or `columns` in place: the scroll position, the keyboard focus
and a card somebody is carrying all stay. So it is safe to call when a colleague's change arrives
on the live stream.

Give the element you mount into a width (it takes the width it is given) and, if the columns
should scroll up and down inside the board instead of the page, a height.

## The map

A pin for each place and a list of the same places beside it (under it, on a narrow screen). A
person picks a pin or its row, drags a pin to the exact spot with a mouse or a finger, or moves
it with the keyboard: Tab to a pin, the arrows to go from pin to pin, Enter to pick one up, the
arrows to move it, Enter to keep the spot, Escape to put it back. Areas can be drawn and changed,
and the pins can be the stops of a route. It is the dashboard's own map, so it behaves the same
there and here.

Your screen owns the rows. It reads them, hands them over as plain data, and saves a dragged pin:

```ts
const { rows } = await staff.list('customers', { order: 'id.asc', limit: 200 });

const map = await kit.mount('map', document.querySelector('#customers'), {
  maps: config.maps,                                              // as the config gave it
  pins: rows.map((row) => ({ id: String(row.id), label: String(row.name), lat: Number(row.lat), lng: Number(row.lng) })),
  locale: config.locale,
  dir: config.dir,
  ariaLabel: 'Customers',
  onSelect: (pinId) => showCustomer(pinId),
  ...(staff.can('customers', 'update')
    ? {
        onMovePin: async (pinId, at) => {
          await staff.update('customers', pinId, { lat: at.lat, lng: at.lng });   // a refusal throws, with the server's sentence
        },
      }
    : {}),
});
```

A screen with no staff session does the same with `fetch` against the data API and answers
`{ refused: reply.error.message }` when the reply is not a success.

### The map's three states

The part never leaves an empty frame. Which of the three it shows follows `maps`, the side's
config handed over as it came:

- **Maps are on and the map server answers**: the map, with the list.
- **Maps are on and the map server cannot be reached** (offline, blocked, down): the list, under
  "The map could not be reached. Here is the list."
- **Maps are switched off** (`maps.enabled` is `false`): the list, under "Maps are switched off.
  Here is the list." Nothing is asked of the map server and the map's code is not fetched. With a
  `settingsHref`, the line ends in a link to it; give one only to a person who may switch maps
  on, and point it at wherever that is done ([Settings → Maps](/guides/apps/maps/) is
  `/settings/maps` in the dashboard).

The list is the same places in all three, each row a button that picks its pin, so a screen
reader, and a person with no map, have everything the map shows.

The map server's address is never written in the kit. It is the one in `maps`, which is also the
one the page's content policy lets the browser reach; a different address would be refused by the
browser. [What a served screen may load](/guides/apps/building-a-side/#what-a-served-screen-may-not-load)
has the rule.

### Props

| Prop | |
|---|---|
| `maps` | The `maps` of the side's config: `{ enabled, server, routing }`. Required. |
| `pins` | The places. Required. Each: `id` (the row's key, as text), `label`, `lat`, `lng`, and optionally `tone` (`neutral`, `accent`, `pos`, `warn`, `danger`, `info`: the pin's colour) and `by` (`'town'` for a position that is only the middle of a town: the pin is drawn hollow and marked "by town", and several in one town stand in a ring round it). A pin whose `lat` or `lng` is not a number is left out. |
| `locale`, `dir` | From the side's config. Required. |
| `selected` | The `id` of the pin that is picked, or `null`. The map keeps what the person picks; pass it only to change the pick from your side. |
| `onSelect(pinId)` | Called when a pin or its row is picked. |
| `onMovePin(pinId, { lat, lng })` | Saves a dragged pin. Left out, no pin can be moved. |
| `areas` | Areas drawn as filled outlines and named in the list. Each: `id`, `geometry` (a GeoJSON `Polygon` or `MultiPolygon`, positions as `[lng, lat]`), and optionally `name` and `tone`. |
| `onAreaChange(areaId, geometry)` | Saves an area that was drawn (`areaId` is `null`) or changed. Left out, areas cannot be drawn. A changed area comes back as the kind it was, with its holes and other pieces kept, so save `geometry` whole. After saving a new one, call `update({ areas })` with the areas read again: the map then knows its id. |
| `route(stops)` | Makes the pins the stops of a route, in their order (below). |
| `units` | `'km'` (the default) or `'mi'`, for a route's legs. |
| `center`, `zoom` | Where the map starts: `[lat, lng]`, and 1 (the world) to 18 (a street). Left out, it fits what it draws. Read once, when the part is mounted. |
| `settingsHref` | Where maps are switched on, for the "switched off" line. |
| `listLabel` | The list's name for a screen reader. Default "Places", or "Stops" on a route. |
| `emptyLabel` | A line in place of the map while there is no pin and no area. |
| `ariaLabel` | The map's name for a screen reader. |
| `theme` | `light` or `dark`, as for every part. The map takes the map server's light or dark style to match. Left out, it follows the page's `color-scheme`, read when the part is mounted, at every `update`, and when the device changes between light and dark. |

### What `onMovePin` must answer

The map leaves the pin where it was dropped and calls `onMovePin`. Answer a promise:

- **resolved with nothing**: the move held. The pin stays.
- **resolved with `{ refused: 'the reason' }`**, or **rejected** with an error: the pin goes back
  where it was, the reason is shown in a line above the map and said to a screen reader. Hand over
  the server's own sentence.

If `onMovePin` answers nothing at all (no promise), the move is taken as saved.

`onAreaChange` answers the same way. A refused change is said in the same line; the shape stays
on the map as it was drawn, to be changed again.

### A route

Give `route` and the pins are numbered, joined in their order, and each row of the list says how
far it is from the stop before. The map calls `route` with the stops (`{ lat, lng, by? }` each)
when it is mounted and again whenever a stop's position changes, and draws what you answer.
[`POST /api/v1/geo/route`](/guides/apps/maps/#routes-are-estimates) answers exactly that:

```ts
route: async (stops) => {
  const reply = await fetch('/api/v1/geo/route', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-adminium-csrf': config.csrfToken },
    body: JSON.stringify({ stops }),
  });
  if (!reply.ok) throw new Error('No route');
  return (await reply.json()).data;
},
```

Until the answer is in, and when it does not come, the legs are drawn as straight dashed lines
and their lengths read "unknown". A leg the server measured as a straight line reads "about".
That route takes 2 to 50 stops.

### What `update` keeps

`update(props)` changes the map that is there; it is never built again. So:

- **the view** is the person's once they have moved or zoomed the map: new pins are drawn where
  they are and the map does not jump to fit them. Until then it fits what it is given, so pins
  that arrive after an empty mount are brought into view;
- **the pick** stays, unless `selected` says otherwise;
- **a pin being dragged** keeps its hold while other pins change.

It is safe to call when a colleague's change arrives on the live stream.

Give the element you mount into a width. With no height of its own the map is 20rem tall and the
list takes the room it needs; with one, the part fills it.

## The import wizard

Rows brought in to one of your app's tables: pasted from a spreadsheet or dropped as a CSV file,
their columns mapped to the table's, each line looked at before anything is written (new, already
here, or refused), then run, with the numbers of what happened. It is the dashboard's own Import
wizard, so it behaves the same there and here.

```ts
const wizard = await kit.mount('import', document.querySelector('#paste-a-list'), {
  connectionId: config.connectionId,
  csrfToken: config.csrfToken,
  tables: [
    {
      table: config.tables.companies,
      label: 'Companies',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'vat_no', label: 'VAT number', unique: true },     // no two companies share it
        { key: 'city', label: 'City' },
      ],
      matchOn: 'vat_no',
    },
  ],
  modes: staff.can('companies', 'update') ? ['skip', 'update'] : ['skip'],
  title: 'Paste a list',
  locale: config.locale,
  dir: config.dir,
  onDone: ({ created, updated, skipped, failed }) => refreshTheList(),
  onClose: () => router.go('/companies'),
});
```

### Props

| Prop | |
|---|---|
| `connectionId` | `connectionId` of the side's config. Required. |
| `tables` | The tables rows may go into. Required. With one, the person is not asked; with several, they pick one by its `label`. Each: `table` (as the config's `tables` gives it), `label`, `columns`, and optionally `matchOn`. |
| `csrfToken` | `csrfToken` of the side's config. Required: the part talks to this Adminium with the person's own session, and the server takes no change without it. |
| `locale`, `dir` | From the side's config. Required. |
| `fetch` | Used in place of the browser's `fetch` for every call the part makes. Left out, the browser's own, with the session's cookie and `csrfToken`. |
| `modes` | What may be done with a line that is already in the table: `'skip'` (left as it is) or `'update'`. The first is the one chosen to begin with; with one, the person is not asked. Default both, `skip` first. |
| `sources` | `'paste'`, `'file'`, or both (the default). |
| `title`, `ariaLabel` | A heading above the steps, or the wizard's name for a screen reader when there is none. |
| `onDone({ created, updated, skipped, failed })` | Called once when an import has run. `failed` are the lines the server refused; they are among `skipped`. |
| `onClose()` | Gives the last step a "Close" button, and is called by it. |
| `theme` | `light` or `dark`, as for every part. |

A table's `columns` are the ones a person may bring in: each `key` (the column's stored name) and
`label`. Mark with `unique: true` the columns no two rows share. When any column is marked, lines
can be matched on the marked ones only; `matchOn` names the one chosen to begin with. With no
match column every line is new.

### What the person's role decides

The part calls the same doors the dashboard does, as the signed-in person, so the server decides
everything, and what it refuses is said in the wizard in the person's language:

- **no right to import** the table: said by the table's `label`, when the lines are checked;
- **matching** lines against the rows already there needs the right to **read** the table;
- **updating** the rows a file matches needs the right to **update** them. The server checks it
  when the import is made and again when it runs, so offer `'update'` only to those who hold it;
- a match column that is **masked** for the person's role is refused, and somebody held to their
  own rows may match only on a column no two rows share. These two are said in the server's own
  sentence;
- more than 32 MB is too large.

A line the table's own rules refuse (a value missing, a number that is not one) does not stop the
import: it is shown as refused before the run, skipped by it, and listed in a report the last step
offers to download.

Somebody whose role is [screens only](/guides/apps/roles-and-staff-access/) can use the part: the
routes of one import are among the few the server answers them, and each still asks the table's
rights. The part reads nothing of the dashboard.

### What `update` keeps

`update(props)` changes the wizard that is there: what was pasted, the mapping and the step the
person is on stay, also when you hand over the same table in a new list. A new `csrfToken` (the
person signed in again) is used by the next call. Picking another table starts over.

Give the element you mount into a width. With no height of its own the wizard is as tall as its
step; with one, the step scrolls inside it.

## The look

The kit brings its own styles and loads them when a part is first mounted. Every rule is held
inside the wrapper the part draws (`.adm-kit`), so nothing changes on your own page: no reset, no
change to your headings, inputs or fonts, and a class of yours that happens to share a name with
one of the kit's (`flex`, `hidden`) is untouched. Your page needs no Tailwind and no stylesheet of
Adminium's. The one thing the kit's sheets say outside the wrapper is the registration of a few
custom property names beginning `--tw-`, which paint nothing.

The part takes your app's look where it has one:

- **Colours** are read from these custom properties, the names Adminium's own themes use:
  `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-strong`, `--fg`,
  `--fg-muted`, `--fg-subtle`, `--accent`, `--accent-fg`, `--accent-soft`, `--accent-soft-solid`,
  `--accent-hover`, `--accent-border`, the four status colours `--pos`, `--warn`, `--danger` and
  `--info` (each with its `-soft` and `-soft-solid`), and the shadows `--shadow`, `--shadow-md`,
  `--shadow-lg` and `--accent-glow`. One that is not defined falls back to Adminium's own value. A side whose values have other names
  hands them over on the element it mounts into:

  ```css
  #comment {
    --surface: var(--color-surface);
    --fg: var(--color-text);
    --accent: var(--color-accent);
  }
  ```
- **Light and dark**: the fallback values follow the page's `color-scheme`. A page that sets
  `color-scheme: dark` gets the dark set. `theme` on a part overrides it for that part.
- **The typeface** is your page's.
- **Right to left** follows `dir`; there is nothing else to set.

## What it costs

Nothing until a part is mounted. The entry is about a kilobyte. The first mount fetches the part,
its words in the person's language, its styles, and the React that draws it, which is the same
file the dashboard uses, so a person who has opened the dashboard already has it. The board also
brings drag and drop (about 14 kB compressed), again the dashboard's own file, and only when a
board is mounted. The map brings the map library (about 290 kB compressed) and its worker (about
150 kB), the dashboard's own files too, and only when a map is drawn: with maps switched off
neither is fetched. The import wizard brings its own code and controls (about 25 kB compressed)
and nothing of the dashboard's first load. The files carry
a hash of their content in their names and are kept by the browser for good.

All of it comes from the address the side is served from, so it fits
[what a served screen may load](/guides/apps/building-a-side/#what-a-served-screen-may-not-load).
A kit part exists only where an Adminium server serves it: a side
[looked at without Adminium](/guides/apps/building-a-side/#looking-at-a-side-without-adminium)
has no kit, and should show the part's place as not available.
