<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § The stylesheets; do not edit -->

# A website template as a working app: The stylesheets

`main.tsx` imports the template's stylesheets in the order the pages linked them. They are kept as
the template wrote them, with three changes, each written as a comment where it was made:

- **Nothing from another host.** A served screen loads no stylesheet, font or script from another
  address ([what a served screen may not load](https://docs.adminium.dev/guides/apps/building-a-side/#what-a-served-screen-may-not-load)).
  A `@import` of Google Fonts or a `url(https://…)` would only fail. Take it out, and bring what it
  loaded as a package.
- **Fonts as packages.** A Google font is installed as its `@fontsource` package
  (`@fontsource/inter`), one import per weight the stylesheet uses, before the template's
  stylesheet. In Adminium Designer the font is asked for with `request_package`.
- **A CSS library from a CDN as a package.** Font Awesome's `<link>` to cdnjs becomes
  `@fortawesome/fontawesome-free`, imported from `main.tsx`.

What the build takes from a stylesheet: pictures (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`,
`.svg`, `.ico`) and fonts as `.woff` and `.woff2`, by lower-case names. A stylesheet that names a
`.ttf`, `.otf` or `.eot` font fails the build. Font Awesome 6's stylesheet names `.ttf` files beside
its `.woff2` ones; version 7 ships `.woff2` only and builds. Use a version whose files the build
takes, or a stylesheet of your own that names only the `.woff2` files, and check the icons still
show.
