---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/engine': patch
'@adminium/widgets': patch
---

Money kept in minor units reads right. A whole-number column named `*_cents`, or `*_minor` with a money word in the name (`amount_minor`, `price_minor_units`, `charge_minor` — a `version_minor` is not money), is shown divided by its currency's ISO 4217 digits — an `amount_cents` of 4900 is €49.00 on a euro row, ¥4,900 on a yen row, KWD 15.000 for 15000 fils and HUF 4,900.00 for 490000 fillér — in the list, the record page and board totals, and its form field is the plain number it holds. Every money cell takes its currency from the column's own currency when one is set, then the row's currency column (the money column's own `amount_currency`, then `currency` / `currency_code`), then the connection's. Pages already generated for an `amount_cents`-style column pick this up without being regenerated.

**Changed:** a money cell on a connection with no currency set now shows the plain number (`1,234.50`) where it used to show US dollars (`$1,234.50`) by default. Set the connection's currency to get the symbol back. KPI cards and charts keep their own number-format setting and are unchanged.
