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
| `phone` | A `text` column of the same table: the number the answer is for. An entry that creates (`POST`) must write it; an entry that only changes rows (`PATCH`) need not, because the box reads the number the row already holds, so a person can answer without being let change their number. On a [people](https://docs.adminium.dev/reference/manifest/#people) table's own entry, it is that table's `phone`. |
| `class` | `service` (texts about what the person booked or bought) or `marketing` (offers). One box is a yes to one of them, never both. |
| `means` | `yes` (the default) or `no`: a ticked box that records the person's no. |
| `wording` | The sentence shown beside the box, in several languages with `en-US` among them, and its `version`. It may not ask for a YES reply. |

The answer is kept in the text consent log for the person the entry finds (`identity`, `claimedBy`,
or the row itself), whose table is declared in `people` with a `phone`. A create that nobody is
linked to yet (an optional `claimedBy` left empty, such as a first booking the desk links later)
keeps the answer on the row it made; the app's texts to that number count it. It is kept for that
exact number, with the sentence and version shown, the language, the network address and the
browser.

A stranger's yes never overrules a no already standing for the number. A person signed in by a
mailed link, or with a session a mailed code raised to verified, is the exception: their own fresh
yes, for the number their own row holds, replaces their own earlier no for this app, whether they
gave it on a form, by a reply, or to staff. It never lifts the stop list: after a STOP only the
person's START does, and their Prefs say so (see
[an app's own reads](https://docs.adminium.dev/guides/texts/stop-and-consent/#an-apps-own-reads)). A marketing yes to a
number in a country that expects double opt-in (Germany) is mailed a confirmation; see
[Marketing texts](https://docs.adminium.dev/guides/texts/marketing/#double-opt-in-in-germany).

`textConsent` may also be a list of two boxes, one per class, so a form asks about service texts
and offers separately. Each has its own `column`, `wording` and version, and each tick is recorded
under its own class:

```json
"textConsent": [
  { "column": "texts_ok", "phone": "mobile", "class": "service", "wording": { "version": 1, "text": { "en-US": "Text me about my stay" } } },
  { "column": "offers_ok", "phone": "mobile", "class": "marketing", "wording": { "version": 1, "text": { "en-US": "Text me offers now and then" } } }
]
```

A staff member who ticks or unticks a box's column (on the record page, or an app's own staff
screen saving through the data routes) records their yes in the box's words, or their no, in the
same log, named to them. A save that leaves the column as it was records nothing.

On a [`forms` entry](https://docs.adminium.dev/guides/add-ons-with-tables/) (the `publicAccess` entry under the key `forms`), the forms door draws the box itself, unticked, under any form whose
"becomes" fills the box's `phone`; a form may not fill the box's `column` from a question.
