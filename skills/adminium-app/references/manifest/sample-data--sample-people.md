<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Sample data — Sample people; do not edit -->

# Manifest spec: Sample data — Sample people

### Sample people

A sample business has people: a rep per pipeline, a crew per van. `people` and `teams` say who
they are, and a sample row names one with [`{ "@person": "<key>" }`](https://docs.adminium.dev/reference/manifest/#sample-data):

```json
"sampleData": {
  "file": "seeds/crm.sample.json",
  "people": [
    { "key": "dana", "name": "Dana Whitlock", "email": "dana@meridian.example", "role": "rep" },
    { "key": "ivy", "name": "Ivy Sandoval", "role": "sales-manager" }
  ],
  "teams": [{ "name": "Sales", "lead": "ivy", "members": ["dana"] }]
}
```

| Field | Rule |
|---|---|
| `people` | 1–200 of `{ "key", "name", "email"?, "role"? }`. `key` is lower-case letters, digits, `_` and `-`, at most 40, and listed once. `role` is the key of one of this app's own [`roles`](https://docs.adminium.dev/reference/manifest/#roles). `email` is shown beside the name and never mailed; where it is left out, or somebody already has it, Adminium gives the person an address of its own (`dana.crm@sample.invalid`). |
| `teams` | 1–50 of `{ "name", "lead"?, "members" }`: the people of one team, by key. `lead` leads it, so a role limited to [its team's rows](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) reaches the members' rows. A team name the operator already uses is left to them: the sample's team is made beside it as "Sales (sample)". |

"Add sample data" makes each person a staff member marked as a **sample person**: no password and
no way to get one, nothing is ever mailed to them, and nothing about them is changed by hand. They
are listed on the Team page under their own status and are in no other count. "Remove sample
data" takes them and their teams away, but for a person a row that stays still names (a deal the
operator made and gave to a sample rep): that person stays until the row names somebody else, and
the next "Add sample data" takes them back instead of making a second one. An add-on's manifest
takes neither field. Needs Adminium 0.3.28.

A rule hands a row to nobody who cannot sign in, so a rule's write that names a person from the
[settings row or the record](https://docs.adminium.dev/reference/manifest/#a-value-from-the-settings-row-and-a-day-so-many-days-on) leaves a sample person out, with one exception: when
the row the run is about is a sample row, it may name a sample person (a sample job's sign-off books
its aftercare call for the sample rep who sold it). A real row is never handed to a sample person.
The rows such a run creates are sample rows too: they are listed with the sample, and "Remove
sample data" takes them with the rest, and with them the sample row they hang off. A rule-made row
somebody has since written a row of their own under stays, as any sample row their records use
does, and a row a rule made from a real row is never listed. Adminium 0.3.35.

The file uses the `adminium.sample/1` format:

```json
{
  "format": "adminium.sample/1",
  "app": "visits",
  "tables": [
    { "ref": "clients", "rows": [{ "@label": "ada", "name": "Ada Byrne" }] },
    { "ref": "visits", "rows": [
      { "client_id": { "@ref": "ada" }, "starts_at": { "@day": 1, "@time": "09:30" },
        "note": { "@t": { "en-US": "First visit", "de-DE": "Erster Besuch" } } }
    ] }
  ]
}
```

| Field | Rule |
|---|---|
| `format` | Always `"adminium.sample/1"`. |
| `app` | The app's `key`. |
| `tables` | At least one `{ "ref", "rows" }`, each with 1–5000 rows, written in the order listed (parents first) and removed in reverse. Every `ref` and column must be declared in `requiredSchema`. |
| `assets` | Optional files for `@asset`: an object from a label to `{ "file": "seeds/…", "sha256": "<64 hex>" }`. |
| `weekAnchor` | Optional: the weekday (`mon` … `sun`) the sample was written for, which `@week` days count from. |

A row may carry an `@label` (letters, digits and `: . _ -`, unique in the file) so a later row can
point at it.

A column numbered [without gaps](https://docs.adminium.dev/reference/manifest/#numbers-without-gaps) is spelled `null` in every sample row
(`"number_seq": null`); its `format` text is whatever the row gives (its own spelling, such as
`INV-S2041`), or empty. A sample row then
stays off the real series: the first real invoice is still number one. Adding the sample is
refused when a row leaves a gapless column out or gives it a number.

A series marked `"sample": true` is the exception, for numbers that are the app's own and no tax
document's (a job's `J-01`). Each sample row gives the column its number, with the `format` text
written the table's way (`"code_seq": 7, "code": "J-07"`), or `null` for a row with no number.
A number twice in one series is refused, and so is a text that does not match its number. The
next real row takes the number after the largest, and goes on from there once the sample is
removed.

A value is plain JSON, or one of these directives:
