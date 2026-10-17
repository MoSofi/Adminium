<!-- produced from apps/docs/src/content/docs/reference/cli.md § `build`; do not edit -->

# CLI reference: `build`

```
adminium build
```

Compiles `adminium.config.ts` into `.adminium/build/`, which `start` loads, and
records which Adminium version built it. It also bundles each file in `hooks/`
and `actions/`, with the npm packages it imports, into
`.adminium/build/server/`; packages with native code stay imports. Pages and
widgets written in React are bundled for the browser into
`.adminium/build/client/`. Each app under `apps/` is checked, its manifest put
together into `.adminium/build/apps/<key>/app.json`, and its screens built
beside it; a server runs the apps from there and builds nothing. It needs the
`esbuild` dev dependency that `new` adds. Run it before deploying; the
project's Dockerfile runs it in its build stage.

An app that does not build is printed with its problems, and the command exits
`2`; the rest of the project is still built.

It fails, naming the file, when a page file and a React page share an
address (`pages/orders.json` beside `pages/orders.tsx`), when a page or widget
has no default export or its settings are not valid, and when its top-level
code needs a browser.

---
