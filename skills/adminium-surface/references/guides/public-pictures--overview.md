<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md; do not edit -->

# Pictures on public pages

A box office shows each show's poster, and a restaurant's menu shows each dish. Staff upload the
picture in the staff screens, and every visitor sees it on the app's public pages. An `<img>` sends
no key and no session, so these pictures are served by a route of their own. It asks for neither,
and serves a picture only when the app declared it public and the row it belongs to is one anyone
may read.
