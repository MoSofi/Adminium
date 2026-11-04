---
'@adminium/manifest': patch
'@adminium/server': patch
---

An app's role may be given a page or a record panel of an add-on the app requires or suggests, as `page:@<id>:view` (`page:@customiser-line:view`), so a shop's own staff role sees the Customiser's panel without the Customiser's own role. The grant follows the role's `tables` on that add-on: given while the add-on is here for the app, taken back when it is switched off or uninstalled, given again when it is back, and kept away once the owner takes it away. The install's check refuses an id the add-on has neither as a page nor as a panel. Needs `minAdminiumVersion` 0.3.44.
