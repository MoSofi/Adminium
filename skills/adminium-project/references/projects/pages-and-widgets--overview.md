<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md; do not edit -->

# Pages and widgets

A [project](https://docs.adminium.dev/projects/) can hold its own browser code:

- **pages**, `pages/<address>.tsx`, which get a place in the sidebar and an
  address, `/p/<address>`, like any generated page;
- **widgets**, `widgets/<name>.tsx`: table cells and dashboard cards that
  page files use by name.

They are React components. `npm run build` bundles them, and `npm run dev`
rebuilds them when you save: open dashboards load the new version.

> **Note: Your code runs in the browser of everyone who opens it**
> A page's code is served to anyone signed in to Adminium, and the data it reads
> goes through Adminium's data API with the permissions of the person looking.
> Keep secrets out of it; server-side work belongs in
> [hooks and actions](https://docs.adminium.dev/projects/hooks-and-actions/). The desktop app and
> `adminium try` never load project code.
