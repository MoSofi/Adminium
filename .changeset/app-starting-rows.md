---
'@adminium/server': patch
'@adminium/manifest': patch
---

An app's starting rows (`seeds`) are written by its install, as an add-on's already were: once, after the tables and their rules exist, into tables that are still empty. An update writes the rows of the tables that version brings and of no other. A refused row stops the install at a new `seeds` step with none written. The manifest check now reads an app's `seeds` (own tables and columns only; no table built on an add-on's shape, no private table, no staff member), and a manifest that has them needs `compatibility.minAdminiumVersion` 0.3.27 or later. Earlier releases accepted the block and wrote nothing.
