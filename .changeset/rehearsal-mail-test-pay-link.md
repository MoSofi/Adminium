---
'@adminium/server': patch
---

A rehearsal's e-mail fills `{{pay_url}}` with a test pay link for a row of that rehearsal, on the server's own address: the row's open test link from the checkout while it works, else a new one that lasts an hour, as a rehearsal's start makes. A rehearsal's e-mail never carries a live link, and a real customer's e-mail never a test one: with only a test-mode service it still has no pay button.
