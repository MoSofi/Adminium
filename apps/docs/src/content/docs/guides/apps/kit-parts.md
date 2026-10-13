---
title: Adminium's own parts on an app's screen
description: Draw one of Adminium's larger parts, starting with the text box that mentions people, inside a screen your app wrote itself: the address in the side's config, the mount call, the props, the look, and what a person who opens only your screens gets.
---

A staff side is a bundle of its own: its own React, or none. Some parts are too large to write
again in every app, and should behave the same everywhere: the text box in which people are
mentioned, the board, the map, the import. Adminium serves these itself, and a screen asks for one
with a small call: "draw it in this element". The part is drawn by Adminium's own React. Yours
never meets it, so a screen written in plain JavaScript can use a part as well as one in React.

Today one part can be mounted: **the mention text area** (`mentions`). `board`, `map` and `import`
are named and arrive in later versions with the same call; asking for one now is refused with an
error whose `code` is `KIT_PART_NOT_YET`.

This is for a **staff side**. A customer side is told nothing of the kit, and a customer address
refuses its files.

## Where the kit is

The staff side's `surface-config.json` names it:

```json
{
  "kit": {
    "contract": 1,
    "entry": "/assets/kit/kit-BHhBq5nz.js",
    "styles": "/assets/kit/mentions-DF31DXoR.css"
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
| `kit.styles` | The kit's stylesheet, or `null`. The kit loads its own styles when a part is mounted; this is only for a page that wants to fetch the sheet early. |
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

## The look

The kit brings its own styles and loads them when a part is first mounted. Every rule is held
inside the wrapper the part draws (`.adm-kit`), so nothing changes on your own page: no reset, no
change to your headings, inputs or fonts.

The part takes your app's look where it has one:

- **Colours** are read from these custom properties, the names Adminium's own themes use:
  `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-strong`, `--fg`, `--fg-muted`,
  `--fg-subtle`, `--accent`, `--accent-soft`, `--danger`, `--danger-soft` and `--shadow-md`. One
  that is not defined falls back to Adminium's own value. A side whose values have other names
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

Nothing until a part is mounted. The entry is under a kilobyte. The first mount fetches the part,
its words in the person's language, its styles, and the React that draws it, which is the same
file the dashboard uses, so a person who has opened the dashboard already has it. The files carry
a hash of their content in their names and are kept by the browser for good.

All of it comes from the address the side is served from, so it fits
[what a served screen may load](/guides/apps/building-a-side/#what-a-served-screen-may-not-load).
A kit part exists only where an Adminium server serves it: a side
[looked at without Adminium](/guides/apps/building-a-side/#looking-at-a-side-without-adminium)
has no kit, and should show the part's place as not available.
