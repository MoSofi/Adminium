---
'@adminium/add-on-contracts': patch
---

A form's agreement tick that waits for a confirmation mail (`confirm`, on by default) is refused with `tick-confirm-email` on a form that asks for no e-mail address (a short answer with `check: 'email'`): the mail would have nowhere to go. Turn the confirmation off, or add the e-mail question.
