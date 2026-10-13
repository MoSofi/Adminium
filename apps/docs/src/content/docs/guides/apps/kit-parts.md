---
title: Adminium's own parts on an app's screen
description: "Draw one of Adminium's larger parts, the text box that mentions people or the board, inside a screen your app wrote itself: the address in the side's config, the mount call, the props, what your screen saves and what the part does, the look, and what a person who opens only your screens gets."
---

A staff side is a bundle of its own: its own React, or none. Some parts are too large to write
again in every app, and should behave the same everywhere: the text box in which people are
mentioned, the board, the map, the import. Adminium serves these itself, and a screen asks for one
with a small call: "draw it in this element". The part is drawn by Adminium's own React. Yours
never meets it, so a screen written in plain JavaScript can use a part as well as one in React.

Today two parts can be mounted: **the mention text area** (`mentions`) and **the board** (`board`).
`map` and `import` are named and arrive in later versions with the same call; asking for one now
is refused with an error whose `code` is `KIT_PART_NOT_YET`. `kit.parts` lists the ones this
Adminium can mount.

This is for a **staff side**. A customer side is told nothing of the kit, and a customer address
refuses its files.

## Where the kit is

The staff side's `surface-config.json` names it:

```json
{
  "kit": {
    "contract": 1,
    "entry": "/assets/kit/kit-BHhBq5nz.js",
    "styles": ["/assets/kit/root-DF31DXoR.css", "/assets/kit/board-Cq0vLx2A.css"]
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
| `maps` | Whether maps are on in this Adminium, the map server's address, and whether routes along roads are on. The same answer the dashboard gets. The map part will need it. |
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
| `columns` | The columns, in order. Required. Each: `id`, `label`, and optionally `tone` (`neutral`, `accent`, `pos`, `warn`, `danger`, `info`: the dot before the heading), `count` (how many cards the column holds in all; left out, the number of cards given), `total` (a figure at the heading's far end, as text), `limit` (the count reads "4/3" and turns red above it). |
| `cards` | The cards. Required. Each: `id` (the row's key, as text), `columnId`, `title`, and optionally `subtitle`, `amount`, `meta`, `lines`, `tag`, `tagTone`, `owner`, `due`, `progress`, `reference` (below). A card whose `columnId` is not a column's `id` is not drawn. Within a column the cards stand in the order given. |
| `locale`, `dir` | From the side's config. Required. |
| `onMove(cardId, toColumnId, fromColumnId)` | Saves a move. Left out, no card can be moved. |
| `canMove` | `false`: no card moves. A function from a card's id to yes or no: only those do. Left out, every card (when there is an `onMove`). |
| `onOpen(cardId)` | Called on a click. A card that cannot be moved is also opened with Enter. |
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
board is mounted. The files carry
a hash of their content in their names and are kept by the browser for good.

All of it comes from the address the side is served from, so it fits
[what a served screen may load](/guides/apps/building-a-side/#what-a-served-screen-may-not-load).
A kit part exists only where an Adminium server serves it: a side
[looked at without Adminium](/guides/apps/building-a-side/#looking-at-a-side-without-adminium)
has no kit, and should show the part's place as not available.
