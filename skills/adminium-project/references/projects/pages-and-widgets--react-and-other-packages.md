<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § React and other packages; do not edit -->

# Pages and widgets: React and other packages

`react`, `react/jsx-runtime` and `react-dom` are the dashboard's own React 19,
so hooks and context work across your code and the kit. `react-dom/client` is
not available: the dashboard renders the page. Other npm packages are bundled
with the page that imports them.

The dashboard's styles do not know your class names. Style with the kit's
components, `style` props, or a CSS file your component imports: it is
bundled and loaded with the page. Images and fonts you import are served with
the build.

Adminium runs the code outside your components once while building, without a
browser, to read `definePage` and `defineWidget`. Keep `window`, `document` and
storage inside components and effects. npm packages are not run then, so a
library that needs the browser when it is imported is fine.

For an editor to check these files, a new project has `@types/react` and a
`tsconfig.json` with `"jsx": "react-jsx"`.
