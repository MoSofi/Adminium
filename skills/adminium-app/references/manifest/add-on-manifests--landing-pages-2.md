<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Landing pages; do not edit -->

# Manifest spec: Add-on manifests — Landing pages

A live page answers at `/x/pages/<slug>`, on the public address, on every host mapped to the add-on
pages and on an app's customer domain alike. Its data is read from `/x/pages/api/<slug>` and its
pictures from `/x/pages/api/<slug>/pictures/<file id>`. A page answers only while its row is `live`,
its `published` copy is a whole page document with no Milo mark, its add-on is switched on and
vouched for, the privacy notice is set, and visitors can reach the server (the forms door's own
check). Anything else, a draft, a page switched off, a slug nobody has, a copy that no longer reads,
answers one same "This page isn't available." `?preview=1` draws the page's `draft`, marks and
all, for a signed-in person who may read the pages table; it sends nothing, counts nothing and is
never indexed. A host's home page may be a live page: `/x/pages/<slug>`, never the door's `api`.

**The head.** Adminium writes the page's head on the server, so a link preview, which runs no
script, sees the page: `<html lang dir>` from the page's language, `<title>` from `title`, the
description, `og:title`, `og:description`, `og:type`, `og:url`, `og:locale`, `og:image` (the
sharing `picture`, as an absolute address), `twitter:card` (`summary_large_image` with a picture,
else `summary`) and `<link rel="canonical">`. Every value is escaped.

**Where it is indexed.** A page has one canonical address: the mapped pages host whose home it is,
else the first mapped pages host by name, else the public address. A live page asked on that host
may be indexed; everywhere else it answers `noindex` and names the canonical address. A preview,
a form, the chat and every page of a trial are always `noindex`.

**Pictures.** A page shows only pictures it owns. Choosing one for a page, from Files or from the
person's computer, makes a copy of it for that page: a PNG, JPEG, WebP or GIF of at most 5 MB,
read again and stripped of what the camera wrote beside it; never an SVG. The door serves a copy
only while the live page that owns it names it, and keeps it in a browser five minutes, so a page
switched off stops showing it. The add-on's editor makes the copy through
`POST /api/v1/landing/<add-on>/pictures?page=<page key>` (the picture as the body, or
`{ "file": "<file id>" }` for a file of Files the person may read), for someone who may change the
pages; a picture refused answers `422`, reason `picture-refused`. `GET /api/v1/landing/<add-on>/status`
says whether visitors can reach the pages, whether the privacy notice is set, the public address,
the mapped pages hosts and, with `?page=<page key>`, the page's address on each and which host it
is home of.
