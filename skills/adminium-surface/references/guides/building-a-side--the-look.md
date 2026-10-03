<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § The look; do not edit -->

# Building an app's screens: The look

The starter's screens come with a look, so a first build is something to show. It is two files on
each side:

- **`src/theme.css`** holds the look as values: the page and card colours, the text and muted
  text, one accent, the corner radius, the shadow, and the typefaces for text and for headings, in
  a light and a dark set. Change the look here, in one place.
- **`src/app.css`** holds the parts, drawn from those values. Use their class names instead of
  writing styles of your own for what a part already does:

| For | Classes |
|---|---|
| The page | `page` (`narrow` for one column), `site-header` with `brand` and `brand-mark`, `hero` with `eyebrow` and `lead`, `section` with `section-head`, `layout` (a wide column and an `aside` that stays in view), `site-footer` |
| What is on offer | a `grid` of `card`s, each with `card-media`, `card-title`, `card-row` and `price`; `stepper` for a quantity; `summary` with a `total` line |
| Forms | `form` of `field`s (a label, the input, an optional `hint`); `btn btn-primary` for the one main action, `btn` and `btn btn-quiet` for the rest; `btn-small`, `btn-block` |
| What the page says back | `notice ok`, `notice error`, `empty`, `badge` with `accent`, `good`, `warn` or `bad` |
| For staff | `toolbar`, a `list` of `list-row`s, a `board` of `column`s; `row`, `muted`, `small` |

A new side starts in the direction **clean**. There are four: `clean`, `warm`, `bold` and `calm`.
Adminium Designer asks which one when it first adds a side (unless the request already said how it
should look), keeps the answer in the app's `look.json`, and its **Change the look** writes
`theme.css` again in another direction. By hand, edit the values in `theme.css`.

Only the typefaces a device already has are used: a served screen may load no font from another
host (see [below](https://docs.adminium.dev/guides/apps/building-a-side/#what-a-served-screen-may-not-load)).

The header shows the app's name. `APP_NAME` from `@adminiumjs/adminium/side` is the name in the
app's manifest when the side was built, so renaming the app renames the header at the next build;
the config's `appName` is the operator's own name for the app, when they set one:

```tsx
import { APP_NAME } from '@adminiumjs/adminium/side';

const name = config.appName ?? APP_NAME;
```
