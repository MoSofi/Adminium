---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

An app's role holding `privacy:@:people` (a shop's owner) now finds, downloads and erases a person only in the apps whose roles give it to them: those apps' people, the copies they declare and the add-on rows those reach, the consent rows and what Adminium keeps about those rows. Another app's people on the same server, the do-not-email list, a forms add-on's answers and stores that only name the address are left to whoever manages privacy for the whole workspace. An address that belongs to a staff account is refused with a sentence of its own, so erasing it can never rewrite the audit log. Holders of the full privacy right are unchanged.
