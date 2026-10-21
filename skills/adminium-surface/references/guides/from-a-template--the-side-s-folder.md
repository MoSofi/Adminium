<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § The side's folder; do not edit -->

# A website template as a working app: The side's folder

A template becomes a customer side, made with `adminium app new <key> --customer`. Its files go in
the side's `src/site/` folder, keeping their own folders, so every `url("../images/…")` in the CSS
still finds its file:

```
apps/shop/customer/src/
├── main.tsx            draws App; the build loads the stylesheets itself
├── App.tsx             one page per address
├── parts/              the header, the footer and the repeated blocks, shared by the pages
├── pages/              one file per template page
├── site/               the template's own files (css/, images/, fonts/), and index.css,
│                       which imports its stylesheets in the order the pages linked them
├── theme.css           the theme's colour variables only, for the parts the app adds
└── design.css          your fixes, loaded after the template's stylesheets
```

Mark the side as one that follows its template: list it under `templateSides` in the app's
`look.json`. The build then loads `theme.css`, `site/index.css` and `design.css`, in that order, so
a fix in `design.css` still wins and a `main.tsx` written again cannot lose the look. It loads none of
Adminium's own look (take `app.css`, `fonts.css` and `style.css` off the side, and their imports out
of `main.tsx`), and it gives the side no Tailwind, even in a project that has it: Tailwind's reset
and its classes of the same name as the template's (`collapse`, `container`) change the template's
look. The style menu then changes only the colour variables, and the notes `adminium app check`
gives about colours, fonts and inline styles are not given for this side: they would ask the
template to change.

In Adminium Designer, `use_site` does all of this: it copies the template's files with the changes
below, writes `site/index.css`, makes each page a screen file in `pages/` with its markup as it was,
and makes each of its content pictures a picture spot, filled with the template's own file, that the
person can swap later. A picture in a repeated block (a product card) becomes a table's picture
instead (see [below](https://docs.adminium.dev/guides/apps/from-a-template/#repeated-content-becomes-tables)); the logo stays a picture of the page.

The template's scripts are not copied in (see [below](https://docs.adminium.dev/guides/apps/from-a-template/#scripts-become-react)). Files no page uses
(SCSS sources, a build tool's settings) stay out.
