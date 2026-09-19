---
'@adminium/add-on-contracts': patch
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
---

**An add-on can own a page in the dashboard, and a row in the sidebar for it.**

Until now an add-on could fill a slot inside somebody else's screen, and nothing
more: the manifest schema refused `pages` outright, and the five sidebar groups
were a closed set written out in five places. So a feature large enough to need
its own screen had to be built into Adminium itself, whatever the plan said.

An add-on's manifest may now declare `pages` — each one a module in its own
bundle, with a title, an icon and where it belongs in the rail — and
`navGroups`, if it would rather bring a group of its own than join one. A page
that names no group lands in **Library**. Several pages of one add-on can sit
together under a heading the add-on brought with it, and that heading carries
its own label, so nothing in the engine has to know the words.

The page itself runs as a page, not as an iframe with a border: the dashboard
publishes its React, its UI kit, its router, its query client, its translations
and its own helpers to the bundle, so the add-on renders inside the shell with
one React, one cache and one history. The module is served over an
authenticated route and pinned to the fingerprint recorded when the add-on was
installed — a package edited on disk afterwards is refused rather than run.

Every way this can fail says which one it is. Not installed, switched off, no
page at that address, the package does not ship the file it names, the module
would not load, the page itself threw: six sentences, six different answers, and
a blank screen is not one of them.
