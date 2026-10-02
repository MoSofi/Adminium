<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Values Adminium fills in; do not edit -->

# A manifest, task by task: Values Adminium fills in

A column's `rules` ask Adminium to keep something true of it. In `jobs` above, `number` is the
next number in a series and `done_at` is written when the status becomes `done`.

| Rule | What it does |
|---|---|
| `options` | The allowed values, from an option list or written inline. |
| `enumLabels` | Words and badge tones for an enum's values. |
| `required` | A value is required on every write. |
| `requiredWhen` | Required only while another column holds one of some values. |
| `validation` | A format (`email`, `url`, `phone`), a `min`/`max`, a `minLength`/`maxLength`. |
| `normalize` | How text is kept: `trim`, `email` (trimmed, lower case) or `code`. |
| `copy` | Takes a value from the linked row (`via` a foreign key, `from` its column). |
| `default` | Fills an empty column on create from the connection's currency or a setting. |
| `sequence` | The next number in a running series; `gapless` for one with no gaps. |
| `format` | Text written from a gapless number: a prefix and padded digits (`INV-0042`). |
| `code` | A short random code, unique in the column. |
| `formula` | A number worked out from the row's other columns. |
| `rollup` | A total or a count over child rows, kept up to date. |
| `stamp` | A value written when something happens: the moment, who did it, a deadline. |
| `lookup` | A foreign key filled from a code a person types into another column. |
| `perNight` | A price worked out night by night. |
| `notAfter`, `notBefore` | A date kept on one side of today, or of another date. |
| `venueLocal` | A time given with no zone is read in the venue's time zone. |
| `personal`, `secret` | Whether the column is personal data, or a secret no reply carries. |
| `retryKey` | The column a staff create keeps its retry key in. |

- One rule decides a column's value. `copy`, `default`, `sequence`, `format`, `code`, `formula`,
  `rollup`, `stamp`, `lookup` and `perNight` cannot be combined, except a `copy` with a `default`
  behind it.
- A column Adminium fills cannot be `writable` in `access.json`, and a primary key takes neither
  `sequence` nor `code`.
- Every name a rule uses must be a column or table of the manifest, of the right type.

Reference: [Column rules](https://docs.adminium.dev/reference/manifest/#column-rules).
