---
'@adminium/engine': patch
'@adminium/server': patch
---

Infer the relations a schema implies but never declares, and let an accepted one
survive the next regeneration.

`RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
five consumers branch on them — `detectDomains` unions relations at confidence
0.8, the column classifier promotes an accepted one to the `fk` semantic,
`detectHierarchy` looks for a self-referential edge, the Studio remap editor
renders an "inferred" bucket, and the LLM normalizer builds its heuristic
baseline from them — but nothing ever wrote one. `model.relations` came
exclusively from declared foreign keys. On a schema that declares none (MyISAM,
legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
the screen: domains shattered into singletons so every table landed in
"General", dashboards were skipped for want of a joined time axis, and every
`*_id` column fell through to `external-id` — a monospaced string where an
entity chip belonged.

`applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
scoring the evidence: an exact singular/plural match on an agreeing declared key
reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
band instead. That band is the point: all four 0.8 gates exclude it, so a weak
guess is visible to the remap editor as a suggestion without acting on anything.
Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
`reports_to`) resolves to its own table, which is what finally lets the tree and
org-chart triggers fire on a schema with no declared self-FK.

Order is load-bearing and looks circular: join detection reads the `fk` semantic,
which the column classifier derives from `model.relations`. So inference runs
first, as its own function — `applyInference` then `applyClassification` — and
deliberately not inside the classifier, which spreads `...model` and rebuilds
only `tables`, discarding anything added within it. It runs in exactly one place,
at introspection, so the snapshot carries the result and a `relation.remove`
override stays removed instead of being re-derived on every run. A schema that
declares its foreign keys is left untouched; nothing here ever emits 1.0.

The second half closes a loop that was open at one end. The `relation.add` /
`relation.remove` overrides were folded in on the read path only, so a relation a
user accepted in Studio appeared in the schema browser and the data API — and
then the next regeneration re-parsed the raw snapshot, saw none of it, and
emitted pages with no FK chip, no related list, and no join. The user's
correction was visible everywhere except the thing it was made to correct.
Accepted relations now reach `generatePages` at confidence 1.0 with
`kind: 'override'`, ahead of the wizard's table filter so an override into an
excluded table is dropped by the same rule that drops a declared FK. One whose
table or column the schema has since dropped is skipped with a warning naming it,
rather than generating a page that cannot load.
