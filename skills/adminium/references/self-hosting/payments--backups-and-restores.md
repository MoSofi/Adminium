<!-- produced from apps/docs/src/content/docs/self-hosting/payments.md § Backups and restores; do not edit -->

# Payments on your server: Backups and restores

The meta store and your shop's database are usually backed up by different hands, at different
times. Payments are written so that a restore of either one does not lose or double a payment:

- **Your shop's database restored to an older point.** Payments written after that point are
  missing from your tables. Every night Adminium checks the live payments of the last 30 days, and
  flags any whose row is gone, voided or for another amount in **Activity**. It never writes. Record
  the missing ones again by hand, or restore the rows.
- **The meta store restored to an older point.** Payments that had finished read as open again.
  Adminium asks the service about them and finishes them again. This is safe because a payment
  written into your table carries the payment's own reference in a unique column: one already there
  is found and not written twice. Payments Adminium keeps itself live in the meta store, so the
  ones after the restore point are written again as they finish.

Test payments live in the meta store only and never touch your tables.
