<!-- produced from apps/docs/src/content/docs/projects/hooks-and-actions.md; do not edit -->

# Hooks and actions

A [project](https://docs.adminium.dev/projects/) can hold its own server code:

- **hooks**, in `hooks/`, run before or after a record is created, changed or
  deleted;
- **actions**, in `actions/`, are buttons on records that run your code.

Both are TypeScript (or JavaScript) files. `npm run build` bundles them, and
`npm run dev` rebuilds and reloads them when you save, without a restart.

> **Caution: Your code runs inside the server**
> Hooks and actions run in the Adminium server process with full access to it
> and to your databases. Treat them like the rest of your backend code. The
> desktop app and `adminium try` never load them.
