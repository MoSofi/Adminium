<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — A table whose name is taken; do not edit -->

# Installing apps: Installing an app — A table whose name is taken

### A table whose name is taken

Adminium never takes over a table it did not make without asking. **Install** waits until each
taken table has an answer:

- **Use it and keep its data.** The app reads and writes the rows already there. This is offered
  only when it is safe. A table with a required column the app never fills is refused, because the
  database would reject every row the app saves; the screen names those columns and says so.
- **Rename the existing table out of the way.** Your table gets a new name (by default the old one
  plus `_old`), and a fresh table is created for the app. Adminium updates its own pages, grants,
  column rules and public endpoints that pointed at the old name, as a
  [schema rename](https://docs.adminium.dev/guides/schema/editing-your-schema/#what-follows-a-change-and-what-does-not)
  does. Not offered when another app records that table.
- **Use a different prefix for this app.** Every table of the app gets the prefix you type, lower
  case and ending in `_`, and the whole check runs again. **Use the usual prefix** goes back.

Picking an answer checks the tables again at once. After typing a new name or a prefix, press
**Check again**; **Install** waits until the check on screen matches your answers.
