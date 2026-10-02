<!-- produced from apps/docs/src/content/docs/projects/pages-and-widgets.md § Building and deploying; do not edit -->

# Pages and widgets: Building and deploying

`npm run build` writes the pages and widgets to `.adminium/build/client/`: one
file each, plus shared chunks and stylesheets, with a hash of their content in
their names. The server serves them at `/api/v1/project/client/` to signed-in
people, and only as they were built. The dashboard checks each file's
integrity before it runs it, and browsers keep them for good, since a new
build has new names.

In `npm run dev`, saving a page or widget rebuilds it, and every open
dashboard loads the new file and draws it again. The page's state starts over;
there is no hot module replacement.
