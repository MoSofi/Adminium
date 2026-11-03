---
'@adminium/dashboard': patch
---

`/email-templates?kind=campaign&link=<https address>` opens "New campaign" at once, and the campaign it makes starts with a text block holding the address after whatever its start gave it (a form's "Send by e-mail"). Anything but an `https://` address of at most 2048 characters is dropped, and the address leaves the bar once it is used.
