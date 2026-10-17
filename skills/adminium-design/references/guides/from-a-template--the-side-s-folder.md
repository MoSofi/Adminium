<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § The side's folder; do not edit -->

# A website template as a working app: The side's folder

A template becomes a customer side, made with `adminium app new <key> --customer`. Its files go in
the side's `src/site/` folder, keeping their own folders, so every `url("../images/…")` in the CSS
still finds its file:

```
apps/shop/customer/src/
├── main.tsx            imports the template's stylesheets, in the order the pages linked them
├── App.tsx             one page per address
├── parts/              the header, the footer and the repeated blocks, shared by the pages
├── pages/              one file per template page
└── site/               the template's own files: css/, images/, fonts/
```

Take the starter's look out of the side: delete `theme.css`, `app.css`, `fonts.css` and
`design.css`. The build then brings no stylesheet of Adminium's, and the design notes that
`adminium app check` gives about a styled screen (classes, colours, fonts) are not given for this
side: they would ask the template to change. Do not pick a style for it, and do not add Tailwind to
a project for it: Tailwind's reset and its classes of the same name as the template's (`collapse`,
`container`) change the template's look. When the project already has Tailwind, say so to the
person before going on.

The template's scripts are not copied in (see [below](https://docs.adminium.dev/guides/apps/from-a-template/#scripts-become-react)). Files no page uses
(SCSS sources, a build tool's settings) stay out.
