<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A box for texts; do not edit -->

# Manifest spec: Public access — A box for texts

### A box for texts

A public entry can also ask for a yes to texts, with a box of its own beside the e-mail tick. It
needs Adminium 0.3.76 or later:

```json
{ "table": "appointments", "methods": ["POST"], "writable": ["mobile", "texts_ok"],
  "textConsent": { "column": "texts_ok", "phone": "mobile", "class": "service",
                   "wording": { "version": 1, "text": { "en-US": "Text me reminders about this visit",
                                                        "de-DE": "Erinnerungen an diesen Termin per SMS" } } } }
```

| Field | Rule |
|---|---|
| `column` | A `bool` of the entry's table that the entry writes. Never the e-mail tick's column: a yes to mail is not a yes to texts. It starts unticked: no default of yes, and no rule, formula or copy sets it. It is never required to book or buy, so it is nullable or defaults to false. |
| `phone` | A `text` column of the same table that the entry writes: the number the answer is for. On a [people](https://docs.adminium.dev/reference/manifest/#people) table's own entry, it is that table's `phone`. |
| `class` | `service` (texts about what the person booked or bought) or `marketing` (offers). One box is a yes to one of them, never both. |
| `means` | `yes` (the default) or `no`: a ticked box that records the person's no. |
| `wording` | The sentence shown beside the box, in several languages with `en-US` among them, and its `version`. It may not ask for a YES reply. |

The answer is kept in the text consent log for the person the entry finds (`identity`, `claimedBy`,
or the row itself), whose table is declared in `people` with a `phone`. It is kept for that exact
number, with the sentence and version shown, the language, the network address and the browser. A
yes never overrules a no already standing for the number. A marketing yes to a number in a country
that expects double opt-in (Germany) is mailed a confirmation; see
[Marketing texts](https://docs.adminium.dev/guides/texts/marketing/#double-opt-in-in-germany).
