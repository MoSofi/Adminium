---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
---

An app's role may now find, download and erase a person's data (`privacy:@:people`, the new `system:privacy:people`), so a shop's owner answers a customer's request without being the Super Admin. The privacy page opens on "A person's data" alone for such a role, the install check names the roles that hold it, and a screens-only role is refused it.
