---
'@adminium/server': patch
---

The link a found person objects through now acts only for the person it was sent to: it names the moment they were found as well as their address, so a link whose person was removed, or whose contact row was since given to someone else, can no longer erase anyone else. Only the address the mail went to is erased; a contact row that now holds another person's address is left as it is. The nightly keeping sweep erases by the address a person was found with, and only what finding them stored: never a person who has agreed to be written to or has become a customer, and never the rest of what is kept at their address. Their own later word (a form's answer) restarts the keeping time.
