---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/manifest': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

An app's payable may now say how it keeps refunds (`refunds`). The column model (the default) writes the refunded total onto the payment row, as before. The rows model (`{ "model": "rows", "table", "payment", "amount", "when", "providerRef", "state", "openIn", "auto" }`) is for an app that keeps a refund as a row of its own refund table: its staff write the row as they always did, a row that sends money back (`when`) may be made only by someone who may refund (`PAYMENT_REFUND_NOT_ALLOWED` otherwise, before the write commits), and Adminium then sends the money back for that row, once, with the amount read once, and stamps the row with the provider's reference and where the refund stands (`asked`, `pending`, `done`, `not-sent`); it never writes an amount into the app's formulas. A refund that cannot be sent is stamped `not-sent` and kept for a person in Activity, and a sweep picks up a row nothing asked for. Refunds asked from Activity for such a payment are refused (`IN_APP`) and say to refund it in the app. Money given back with no row of the app's (a refund made in the provider's dashboard, a lost dispute) is written to the payment row's `refundedElsewhere` column. A refund of money already taken now reaches its record even after the app was switched off. Meta migration 0091 adds `refunds.app_connection`, `app_table` and `app_row_key`.
