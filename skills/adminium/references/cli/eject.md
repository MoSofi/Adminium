<!-- produced from apps/docs/src/content/docs/reference/cli.md § `eject`; do not edit -->

# CLI reference: `eject`

```
adminium eject <address>
```

Turns a page file into a page written in React: it writes
`pages/<address>.tsx` and deletes `pages/<address>.json`.

```bash
npx @adminiumjs/adminium eject orders
```

The new file holds the page file's settings as a constant, and draws them
with the UI kit's `GeneratedPage`, so the page looks and works as before. From
there it is yours to change; see
[Pages and widgets](https://docs.adminium.dev/projects/pages-and-widgets/#starting-from-a-generated-page).

The page keeps its address, its place in the sidebar, who can see it and its
saved views: `dev`, or a server's next start, gives the page's row to the new
code instead of deleting it. Regenerating the database no longer changes the
page. To undo, restore the page file and delete the `.tsx` file (with
`git restore` and `git rm`, for example).

It needs no database. It refuses an address that has no page file, one that
is already code, a page file that is not valid, and a page that is turned off.

---
