<!-- produced from apps/docs/src/content/docs/guides/apps/shared-menu.md § Installing the second app; do not edit -->

# A menu two apps share: Installing the second app

Install Point of Sale, then the online shop, or the other way round. When the second app declares
a shape the first already keeps tables of, **Check the tables** asks which menu it uses:

- **Use Point of Sale's menu.** The recommended answer, and the one taken when none is given. Its
  tables show the badge **Shared with Point of Sale**, under Point of Sale's real names
  (`pos_menu_items`), whatever prefix the shop's own tables get. Columns the shop adds are listed
  ("Adds 2 columns to Point of Sale's tables") and are added to those tables; nothing Point of Sale
  reads changes. The shop's order lines then point at Point of Sale's dishes.
- **Keep a separate menu.** The shop makes its own tables under its own prefix, and the two menus
  never meet.

When more than one installed app keeps that menu, each is offered, and the first installed is
recommended. Through the API, the install takes the answer per shape:
`"shares": { "menu@1": { "action": "share", "with": "pos" } }`, or `{ "action": "separate" }`.

Two more things follow from sharing:

- **Rules both apps keep.** Labels, choices and column rules on a shared table are kept once. A
  rule the first app already keeps is not written again: the install skips it and names the app
  that keeps it.
- **Public endpoints.** A public endpoint takes its name from the table's real name, so two apps
  sharing a table can ask for the same one. The check then says so with `SHARE_REF_TAKEN`, naming
  the endpoint and whose it is, and **Install** is refused until the app keeps a separate menu or
  that endpoint is removed.
