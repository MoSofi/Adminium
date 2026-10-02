<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Table names and `prefixed`; do not edit -->

# Manifest spec: requiredSchema — Table names and `prefixed`

### Table names and `prefixed`

Without `prefixed`, each table is created under its `ref` exactly (`visits`).

With `"prefixed": true`, Adminium names each table `<key>_<ref>`, with any `-` in the key written
as `_`: the `visits` table of an app keyed `visits` becomes `visits_visits`, and the `tickets`
table of `pos` becomes `pos_tickets`. The full name must fit in 63 characters. The app reads the
real names at runtime from its `surface-config.json` (a `tables` map from each ref to its real
name), so its code never hard-codes the prefix. Pages, rules, roles and public endpoints in the
manifest always use the short refs; Adminium maps them. The staff side's config also carries
`sharedTables`: each of the app's tables another installed app uses too (a menu shared with the
till), with those apps' keys, so a screen can say that a change there reaches the other app.

Prefixing is opt-in because an app built before it existed hard-codes its table names. New apps
should use it. No table may end up in Adminium's own `adminium_` namespace.
