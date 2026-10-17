<!-- produced from apps/docs/src/content/docs/guides/apps/from-a-template.md § Repeated content becomes tables; do not edit -->

# A website template as a working app: Repeated content becomes tables

Each kind of repeated block is a table of the app: `products`, `posts`, `testimonials`, `team`. Its
columns are what one block shows (a name, a price, a picture, a short text, an author, a date),
plus what the pages need to pick and order rows:

- a yes/no for each place a row may show (`on_home`, `popular`), where two pages show different
  rows of one table;
- a `position` to put rows in order: a public list comes in key order, and the screen sorts;
- a yes/no that hides a row from the public (`on_sale`, `published`, `shown`), held by the entry's
  `filters` in `access.json`.

A picture is an image column (`"semantic": "image"`) and the entry lists it in `pictures`, as
[pictures on public pages](https://docs.adminium.dev/guides/apps/public-pictures/) says. Each table gets a dashboard page
(`page-crud`), so the owner edits the shop from the dashboard. The screen keeps the template's
markup for one block and fills it from each row. While the rows load it shows a line in their
place, and when they fail, a sentence of its own.

**The sample rows are the template's own blocks**, one row for each block the template shows, in
its order, with its words and its pictures: the shop page that showed eight chairs shows eight
again. Templates repeat a few items to fill a grid (three chairs shown eight times); keep the
repeats, so the page looks as it did, and tell the person which rows are filler to rename or
delete. Each sample row names its own picture: give every row its own `@asset` label, even where
two rows show the same file. A picture Adminium keeps belongs to one row, and a second row naming
the same asset shows an empty frame.

What is written once (a hero's heading, the "why choose us" blocks with their icons) stays in the
markup. Say in the plan that it can become a table later.
