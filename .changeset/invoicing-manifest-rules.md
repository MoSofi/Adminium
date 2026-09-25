---
'@adminium/manifest': patch
'@adminium/add-on-contracts': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's manifest can now describe what an invoicing app needs, and Adminium
stores it with the app's other rules.

- **Worked-out values.** A column may say `rules.formula`: a line's amount
  from its quantity, rate and discount, a document's tax and total. The
  arithmetic is exact — never through a floating-point number — and rounds
  once, to the column's new `scale` (0–4 decimal places, or `"currency"`:
  the decimals of the row's own currency, so a JPY total has none and a KWD
  total three).
- **Numbers without gaps.** `sequence.gapless` numbers rows with no gaps and
  none repeated, optionally per parent row (`scope`) and from a setting
  (`startSetting`); `rules.format` writes the number with its prefix
  (`INV-2042`).
- **Fills from elsewhere.** `rules.default.from` fills a value on create from
  the connection's currency, a column of the app's settings row, or a setting
  of an add-on the app requires.
- **States.** A table may declare `states`: the moves between them, what
  stays open once a row is locked, child tables tied to its state, and when a
  row may never be deleted.
- **More stamps.** Today's date on the venue's calendar, the signed-in
  person's own details, a date so many days after another, and a fingerprint
  of the row and its lines. A stamp may also be written when a column is
  first filled.
- **Add-ons an app needs.** `addOns` lists the add-ons an app requires or
  suggests, and the features that need them; `documents` lists the document
  profiles an app ships for its own tables. An add-on may define `shapes`
  that apps build their tables on (`builtOn`).
- **Public access.** New claim kinds (a sign-in link emailed to the address,
  and a share link by token), `visibleWith` for child rows that are only as
  visible as their parent, `files` and `documents` a signed-in person may
  open, and conditions that a value is still empty (`null`) or a date is
  today or later (`from-today`).
- **Held emails.** An app's outbox may hold what it produces until someone
  approves it, date it for later, let a later reminder overtake an earlier
  one, drop reminders that are no longer needed, and change a linked row once
  an email has gone.

The validator now also returns `warnings` beside its issues: advice that
never refuses a manifest. The first says when a column will be required at
install because it is neither nullable nor given a default.

Uploading an add-on built for a newer Adminium now says which version it
needs, instead of refusing its manifest as not valid. An add-on's `attaches`
range may use any semver range, such as `>=0.2.0`.

The column inspector in Studio describes each of these rules in words.
