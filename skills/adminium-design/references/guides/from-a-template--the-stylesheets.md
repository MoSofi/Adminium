<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § The stylesheets; do not edit -->

# A website template as a working app: The stylesheets

`site/index.css` imports the template's stylesheets in the order the pages linked them. They are kept
as the template wrote them, with four changes, listed in a comment at the top of each:

- **Comments out.** A licence comment (`/*! … */`) stays.
- **Extensions in lower case**, in the file's name and in every reference to it.
- **A `url()` to a file the template lacks** is set to `none`.
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
`.svg`, `.ico`) and fonts as `.woff`, `.woff2`, `.ttf`, `.otf` and `.eot`, by lower-case names. An
icon font's stylesheet (Font Awesome 6's) names `.ttf` files beside its `.woff2` ones, and builds.
