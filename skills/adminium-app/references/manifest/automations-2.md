<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations; do not edit -->

# Manifest spec: Automations

A notice is about its record, and its title and body carry the record's values. So a notice to
roles, or to people listed by hand in the dashboard, goes only to those of them whose roles **open
the record**: they read its table, and the row is among the rows they reach. A sales manager whose
reach is her own team is not told of another team's quote. Nobody left is a line in the run's log
(`notified 0 people`), not a failure. A notice about a row that was removed goes only to those
whose read of its table is not limited to some rows, since a removed row cannot be read again to
ask. A rule that runs for no record (a clock with no rows to visit) tells everybody it names.
Each of them is told the record **as they read it**: a column their role is not shown is empty in
their notice (`{{record.<column>}}`, `{{was.<column>}}` and the name a staff column names alike),
so give such a placeholder a backup, `{{record.cost|-}}`.
