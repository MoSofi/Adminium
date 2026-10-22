---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/engine': patch
'@adminium/widgets': patch
---

Money kept in minor units reads right. A whole-number column named `*_cents` (or `*_minor` beside money words or a currency column) is shown divided by its currency's own digits — an `amount_cents` of 4900 is €49.00 on a euro row, ¥4,900 on a yen row and KWD 15.000 for 15000 fils — in the list, the record page and board totals, and its form field is the plain number it holds. Every money cell takes the currency from the row's own `currency` / `currency_code` / `*_currency` column first, then the connection's; with neither it shows the plain number instead of guessing US dollars. Pages already generated for an `amount_cents`-style column pick this up without being regenerated.
