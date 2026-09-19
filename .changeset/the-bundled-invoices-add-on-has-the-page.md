---
'@adminium/server': patch
---

**The invoices screen comes back, as the add-on's page.**

0.2.12 removed the invoice manager and editor from Adminium and left nothing to
replace them: the add-on it bundled was from before the page moved in, so an
upgraded instance had no invoices screen and nothing to adopt. The documents
were never touched, but there was no way to open them.

The bundled set now carries the version that provides the page. On the first
boot after upgrading, an instance whose invoice table has rows installs it
once, unattended, and the rail row returns — under Library, where the add-on
asks to sit. An instance that never authored an invoice installs nothing.

If you are on 0.2.12, this is the release to move to.
