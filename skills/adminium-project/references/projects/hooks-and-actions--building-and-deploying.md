<!-- produced from apps/docs/src/content/docs/projects/hooks-and-actions.md § Building and deploying; do not edit -->

# Hooks and actions: Building and deploying

`npm run build` bundles each file in `hooks/` and `actions/` with the npm
packages it imports into `.adminium/build/server/`. Files whose names start
with `_` are not hooks or actions, so shared code can live in
`hooks/_shared.ts`. `npm run check` loads the built files the way the server
does and names any that would not load.

Packages with native code, such as database drivers, are not bundled. They
stay imports, so they must be installed where the server runs. The project's
Docker image copies the project folder without its `node_modules`, so keep
them out of hooks and actions that you deploy that way.

On a server, a file that fails to load is skipped and listed in **Studio →
Settings → Project**; the rest keep working. How to get the project onto a
server at all: [Deploy a project](https://docs.adminium.dev/projects/deploy/).
