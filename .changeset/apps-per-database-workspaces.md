---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/add-on-contracts': patch
'@adminium/i18n': patch
'@adminium/server': patch
---

The same app or add-on can be installed once per database. Each copy has its own row, roles, settings, outbox, templates, keys, document profiles and rules, and a request says which copy it means (`X-Adminium-Install`, `?connectionId=` or a `key~slug` address); with several copies and nothing said, the answer is `409 APP_INSTALL_AMBIGUOUS`. The first copy keeps the plain addresses; a later one gets an address from its database's name. When the first copy is uninstalled, its plain address says where the app is now ("installed on kiln", `410 APP_ADDRESS_RETIRED`) and is taken again only by an install that asks for it (`bareAddress: true`). One version runs on a server: copies are updated one at a time, each with its own review. An add-on declares `addOn.scope: "server"` to stay once per server, and a side declares `frontends[].instances` to open for every copy. A legacy instance can be made an install of its own in one reviewed step (`/apps/:key/instances/:slug/adopt`), which copies its settings and grants its staff screens to the roles that opened the first copy's.

Databases can be grouped into workspaces (`/workspaces`), many-to-many, with the server's view (`ui.workspaceView`) and each person's last workspace; list routes take `?workspaceId=` to narrow, and the bootstrap lists the workspaces a person can see.

Installing and updating are stricter. An update that stops after its version moved is finished by running it again, its pages, rules, roles, mails, documents, keys and starting rows included. An upload says where a file goes (`install`, `update`, `install-another`); an older version, or a self-made app of another lineage under the same key, is refused. `existing: "use"` installs onto the tables already there with no change to any of them, and refuses one it would have to change (`EXISTING_TABLE_UNUSABLE`). A self-made app's file is not installed back onto the database it was saved from (`SAVED_FROM_HERE`), and its review shows where it was made, what the owner fills in after the install, and the parts it carries. A suggested add-on that cannot be had never stops an install. A self-made app may give a table its real `name` and, on Postgres, its `schema`. Each needs Adminium 0.3.49.
