<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § Its pages are a screen, not a wall; do not edit -->

# Add-ons that keep tables of their own: Its pages are a screen, not a wall

A page of the add-on's own code is shown only to someone whose role holds that page. That hides
the screen. What actually protects the data is the same thing that protects every table in
Adminium: a person reads or writes one of the add-on's tables only with a role that grants that
table, whichever screen or API they come through.

The page's code is handed out the same way: only to someone who may open the page, and to nobody
while the add-on is switched off for the dashboard. Three rules keep that true:

- A page is built into a file of its own. A file a slot loads is served to everybody signed in, so
  an add-on whose page and slot name the same file is refused.
- A page's name opens it, so no two add-ons installed together may share one. An add-on whose page
  is named under another installed add-on's key (`inventory` naming `inventory-pro-stock` beside
  `inventory-pro`) is refused with `ADD_ON_PAGE_REF_TAKEN`.
- A version that drops a page takes the page back from the add-on's roles, and uninstalling takes
  it back from every role, your own included.
