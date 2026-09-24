---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Columns Adminium fills in: stamps, balances, unique values and relative filters.**

- A **stamp** writes the time, or who did it, when a row is made or a column changes to a value
  ("checked in at", "cancelled by"); a guest's write can stamp something else than the staff's.
- A total can count only some child rows (`where`) and keep a **balance** (a fee less payments and
  write-offs). With **`cap`**, a change that would take a balance below zero is refused with
  `BALANCE_EXCEEDED`; a payment taken while another is being written waits for it.
- A column can be **unique**, enforced by the database under the real table's name.
- Public endpoints can filter on the venue's **today** or the days from today, allow a column only
  certain values, and change a row only while it is in a given state or still ahead.

Studio's column inspector shows each of these rules.
