<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — What the plan does with each table; do not edit -->

# Manifest spec: requiredSchema — What the plan does with each table

### What the plan does with each table

Every table in `requiredSchema` falls into one of four cases:

| Case | When | Default action |
|---|---|---|
| New | Nothing with that name exists. | Create it. |
| This app's own | An earlier install of the same app recorded it. | Reuse it. |
| Shared | Another installed app recorded it under the same [`shape`](https://docs.adminium.dev/reference/manifest/#tables). | Share it. |
| Taken | It exists and no install records it as this app's. | The operator chooses before installing. |

For a taken table the operator can **reuse** it (offered only when the table has no required
column that the app would never fill), **rename the existing table** out of the way (to
`<name>_old` unless they choose a name), or give the whole app **a different prefix**, which
applies to every table at once and is meaningful for a prefixed app.

A reused or shared table may need changes first. The plan offers only changes that cannot lose
data: adding a missing column (created nullable), widening a type (a longer `varchar`, `varchar` to
`text`, `int` to `bigint`), making an integer key number itself, adding enum values, and giving a
column declared `fk` the foreign key it lacks (a column first made a plain `int`: the check names
rows that point at nothing, `LINK_ORPHANS`, and nothing changes until they are put right). A missing
`id`, `fk` or `blob` column cannot be added to an existing table, and a column whose type cannot
hold the app's values is refused by name.

A foreign key's target must be one of the package's own tables or a table that already exists in
the database.
