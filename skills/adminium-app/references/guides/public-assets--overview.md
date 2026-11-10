<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md; do not edit -->

# Models, fonts and SVG pieces on public pages

A maker's shop shows each product in a 3D viewer, offers the product's print file, draws a
customer's name in the shop's own font, and lays out the SVG pieces a book nook is cut from. Staff
upload these files in the staff screens. Every visitor's browser loads them on the app's public
pages: a viewer `fetch`es the model, a page's `@font-face` loads the font. These requests send no
key and no session, so the files are served by a route of their own, on the same terms as
[pictures](https://docs.adminium.dev/guides/apps/public-pictures/): only when the app declared them public and the row they
belong to is one anyone may read.

Needs Adminium 0.3.43.
