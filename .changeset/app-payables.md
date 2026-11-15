---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/i18n': patch
---

An app from the catalog may now say which of its tables a customer pays, in `payments.payables` (the ways to pay and the pay page stay the shop's, from a file made here only). Installing or updating such an app asks for no payments right: its payables arrive switched off, for someone who manages payments to switch on. Each is checked at install against the tables the app made, as the payments screen checks a person's mapping, and only on tables the app made itself, never one shared with another app or made by hand. An update that changes how an app's money lands switches it off again and tells the payment managers. A payable may also say when a row may be paid (`payableWhen`), which states the paid and refunded moves start from (`status.from`, `status.refundedFrom`; each must be a move the table's states list), where the customer comes back (`returnTo`, a path with no query), who sends the receipt (`receipt`), whether the pay page offers only online ways (`onlyOnline`) or only ways that settle at once (`instantOnly`), a currency from the settings row, and the payments table's columns for the service, a terminal's approval code, the last four, the currency and the moment paid. An invoice built on the Invoices shape is declared with `{ "table", "shape": true }`. These words need Adminium 0.3.59.
