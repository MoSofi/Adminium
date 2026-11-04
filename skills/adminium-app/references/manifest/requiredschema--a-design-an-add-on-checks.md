<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — A design an add-on checks; do not edit -->

# Manifest spec: requiredSchema — A design an add-on checks

### A design an add-on checks

A table's `check` has an add-on that keeps designs (what a shopper typed, chose and uploaded on a
ready-made design) say whether the design an order line names may be ordered as it is, and which
priced features it uses, inside the save and the dry run. From Adminium 0.3.43.

```json
{ "ref": "order_lines", "columns": [ … ],
  "check": { "by": { "addOn": "customiser" }, "design": "design_id",
             "paid": { "table": "line_features", "via": "line_id", "feature": "feature" } } }
```

| Field | Rule |
|---|---|
| `by` | `{ "addOn" }`: the add-on that answers, named in `addOns.requires` or `addOns.suggests`. It must declare [`addOn.checker`](https://docs.adminium.dev/reference/manifest/#the-design-question). |
| `needs` | Optional. A feature of the app (`addOns.features[].id`): the rule runs only while it is on. |
| `design` | The line's link to its design: a column of this table with `rules.addOnLink` into the add-on's designs table. A line whose link is empty is not asked. |
| `paid` | Optional. Where the line keeps the features it pays for: a child `table`, its `via` (a foreign key to this table) and its `feature` column (text, enum, whole number or a link), one feature a row. Without it, the line pays for none. |

Adminium reads the line, its design and what the add-on declared it reads, asks the add-on's code
once for the save's lines, and refuses the save when:

- the add-on says a design does not stand (a reason from its closed list: `too-long`,
  `required-empty`, `font-not-allowed`, `size-out-of-range`, `colour-not-allowed`,
  `choice-not-allowed`, `part-locked`, `file-missing`, `file-kind`, `design-unknown`,
  `format-unknown`, each with the `part` it is about where it has one);
- the features the design uses are not the features the line pays for, as sets: a feature used
  and not paid for (`feature-not-paid`), one paid for and not used (`feature-not-used`), one paid
  twice (`feature-paid-twice`), each with the `feature`;
- a design's reads come to more than 400 rows (`design-too-large`), never asked on a part of them;
- the add-on cannot be asked: not installed as it should be, switched off for the app, or its code
  not loaded because nobody vouches for its package (`check-unavailable`); or its code threw, ran
  past 250 ms or answered something that is not an answer to the question (`check-failed`).

A staff save is refused `409 CHECK_REFUSED` with `details.column` (the design link), `reason`, and
`part`, `feature` or `refusals` where there are some. A public create is refused
`PUBLIC_WRITE_REFUSED` with the row (`child`, `index`), the column the guest typed the design's
code into (the link's `lookup.from`, else the link itself), the `reason` and its `part` or
`feature`: every reason is about the guest's own design. The question is asked again when a
change moves a line's design link, or a paid feature's line or feature; a removal never asks it.
The rule has no switch to turn it off: a design nobody checked is never ordered.
