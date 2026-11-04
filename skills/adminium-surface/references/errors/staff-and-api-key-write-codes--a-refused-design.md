<!-- produced from apps/docs/src/content/docs/reference/errors.md § Staff and API-key write codes — A refused design; do not edit -->

# Error codes: Staff and API-key write codes — A refused design

### A refused design

`409 CHECK_REFUSED` — an order line's design may not be ordered as it is: the add-on that keeps
designs refused it, or its features are not the ones the line pays for (see
[A design an add-on checks](https://docs.adminium.dev/reference/manifest/#a-design-an-add-on-checks)). From Adminium
0.3.43. `details.column` is the line's design link, `details.reason` says what:

| `reason` | Means | Also in `details` |
|---|---|---|
| `too-long`, `required-empty`, `font-not-allowed`, `size-out-of-range`, `colour-not-allowed`, `choice-not-allowed`, `part-locked`, `file-missing`, `file-kind`, `design-unknown`, `format-unknown` | The add-on's reason the design does not stand. | `part`; `refusals` when it gave more than one |
| `feature-not-paid`, `feature-not-used`, `feature-paid-twice` | The design uses a priced feature the line does not pay for, the line pays for one the design does not use, or pays for one twice. | `feature` |
| `design-too-large` | The design's reads come to more than 400 rows. | — |
| `check-unavailable` | The add-on cannot be asked: switched off, being updated, or its code not loaded. | — |
| `check-failed` | The add-on's code threw, ran past its time, or did not answer the question. | — |

On the public API the line is refused as [`PUBLIC_WRITE_REFUSED`](https://docs.adminium.dev/reference/errors/#a-refused-write), with the row,
the column the guest typed the design's code into, and the same `reason`, `part` and `feature`.
