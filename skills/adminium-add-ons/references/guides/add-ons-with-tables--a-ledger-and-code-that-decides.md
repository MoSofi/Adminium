<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § A ledger, and code that decides; do not edit -->

# Add-ons that keep tables of their own: A ledger, and code that decides

An add-on may keep a [ledger](https://docs.adminium.dev/reference/manifest/#ledgers): tables Adminium writes for it inside
the save of another table's row, from rows the add-on's own code answers. The add-on thinks;
Adminium reads and writes.

The code is **one file**, a classic script with no `import` and no `require`, at most 512 KiB,
that sets `module.exports = { rows }`. `rows(input)` is called with the lines to plan, the rows
Adminium read for it (the action's `reads`), the add-on's one settings row, and the moment as
text (`now`, `today`, `zone`). It answers the rows to insert or update, any refusals, and — in
`words` mode — what is left of each line.

- **It is pure.** No clock, no randomness, no network, no timers: `Date`, `Intl`, `Math.random`,
  `fetch`, `setTimeout`, `eval` and `Function` are not there. The same input gives the same
  answer.
- **It is quick.** A call is stopped at 250 ms and the save refused; a call over 50 ms is logged.
  The server waits on it, so a slow answer slows every request.
- **It is checked.** Every row it answers must be for a table and column the ledger's `writes`
  list, must hang under a row one of its reads returned, and is prepared, capped and settled by
  Adminium like any row. An answer that fails a check fails the save
  (`POSTING_REFUSED {reason: "planner-failed"}`) and leaves one audit row, `ledger.refused`, that
  says which check.
- **This is hardening, not a sandbox.** It stops mistakes, not an attacker. So the file runs only
  when its package is one this server can vouch for: bundled with the release, or downloaded from
  the catalogue. A package uploaded by hand installs, and every save that would ask its code is
  refused `add-on-unavailable` until that version is released. On a developer's own server,
  `ADMINIUM_ADD_ON_DEV_TRUST` names the add-ons whose code runs as it is.

The contracts package ships a conformance suite, `postingRowsConformance`, that an add-on's own
tests run over its case table: every answer inside `writes`, a give-back that nets to zero, two
calls that agree.
