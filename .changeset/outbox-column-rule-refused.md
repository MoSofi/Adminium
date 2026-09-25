---
'@adminium/manifest': patch
---

A manifest is refused when a column the outbox gives to Adminium (its status, sent time, error, skip reason, approver or effect columns) also has a rule that decides its value, such as a stamp of who approved. The install used to accept it, and then every message the desk made was refused with "approved_by is written by Adminium". The refusal names the column and the rule.
