---
'@adminium/add-on-contracts': patch
'@adminium/server': patch
---

A form can now end on a landing page: the new ending `{ kind: 'landing', page, addOn }` (in `FORM_ENDING_KINDS`) sends the person to that page after they send the form, at its address on the host they are on. If the page is not live, they see the usual thanks instead.
