---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A variable that nothing fills, and that has no backup, now stops an email where a person is there to put it right. A campaign that reads one cannot be sent: the send form names it, and so does the assistant's card. A rule's Test fails at the email step and names it. A rule that runs on its own still sends the email with the variable as written and says which one under the step, as before.

A campaign made from a starter that reads its own variables (an order number, a tracking link) is refused until those have a backup or are taken out: such a campaign used to reach every recipient with `{{order_number}}` in it.
