---
'@adminium/manifest': patch
'@adminium/server': patch
---

A manifest is refused when a column the outbox gives to Adminium (its status, sent time, error, skip reason, approver or effect columns) also has a rule that decides its value, such as a stamp of who approved, or one that refuses a value (allowed values, a validation, required, a date bound). The install used to accept it, and then every message the desk made was refused with "approved_by is written by Adminium", or stuck when Adminium's own write was refused. The address and the language the outbox writes when it looks them up take no rule that decides them, nor allowed values or required; a validation of an address a person types is still fine. The refusal names the column and the rule, and a Studio save refuses the same rules on an installed outbox's columns.
