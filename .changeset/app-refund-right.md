---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's role may now carry `payments:@:refund`: the right to give back the money paid online for that app's own records (`payments:<app>:refund`), never the install's refund right, which also reaches the Invoices page. The install check lists each such role, ticked, and the installer may untick one (`refundsUnticked`); an untick is remembered, so an update never gives it back unasked, and an update that newly gives it asks first (`roleGrants`). The refund route, the record panel and the refund-row guard accept it for the app's payments. Needs Adminium 0.3.59.
