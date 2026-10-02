<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — Limits on a stranger's create; do not edit -->

# Manifest spec: Public access — Limits on a stranger's create

### Limits on a stranger's create

`anonymous` limits a create that nobody signed in for: an entry with no claim at all, or an
optional `claimedBy` create made with no session. It needs `POST`.

| Field | Rule |
|---|---|
| `perValue` | `{ "columns", "n" }`: at most `n` (1–20) creates a day for one phone number or address in any of these `text` columns (1–4), through any key or page. A phone number counts by its last nine digits, and an address in lower case, so two spellings of one number are one number. |
| `perKeyHour` | At most this many (1–1000) such creates an hour through the key, from everyone. |
| `perIpHour` | At most this many (1–60) such creates an hour through this entry from one visitor (an IPv6 subscriber's whole /64). Every visitor is held to 60 an hour on any key; this only lowers it. |
| `plainText` | 1–8 `text` columns that hold plain text only: letters, spaces and sentence punctuation (Latin, CJK such as `，。` and Arabic such as `،`), up to 80 characters, with no digits and no web or email address in its common forms (a known ending such as `.com`); "Mary.Ann", "J.R.R. Tolkien" and "K.Y.Ng" pass. A column given as `{ "column": "note", "digits": 4, "max": 140 }` takes up to `digits` (1–4) digits in all and up to `max` (at most 200) characters ([Plain text](https://docs.adminium.dev/guides/apps/identity-and-own-links/#plain-text)). The same rule as a [guest's change](https://docs.adminium.dev/reference/manifest/#limits-on-a-guests-change), held on every create (signed in or not) and on every change that writes the column. |

A create over a limit is refused with `PUBLIC_LIMIT_REACHED`, and one that breaks `plainText` with
`PUBLIC_WRITE_REFUSED`. A single create refused for another reason (the slot was taken) does not
count, except against the visitor's hour. A [create with child rows](https://docs.adminium.dev/reference/manifest/#a-create-with-its-child-rows)
gives its charge back only when a value the guest typed was refused; any other refusal of the whole
write (sold out, busy, a changed price) keeps it. A [quote](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries) is
never charged.

An entry anyone may call (no claim, no parent, or a create a session is optional on) may not
`select` a personal column: one marked `personal`, or one whose name the install reads as personal
data (an address, a phone number, a birth date, a person's name on a table of people).
See [Limits on a stranger's create](https://docs.adminium.dev/guides/apps/public-access/#limits-on-a-strangers-create).

`requireSetting` switches an entry off from the settings row: while one of its bools is false,
writes through the entry are refused with `PUBLIC_SWITCHED_OFF`. With `"when": "anonymous"`, the
switch holds only for a create with no session, so a found patient can still book while new
patients are turned away; it is allowed only on an optional `claimedBy` entry. A switch is read
from the settings table and trusted for 15 seconds. No row, no column or a failed read counts as
off. See [Switches in the settings row](https://docs.adminium.dev/guides/apps/public-access/#switches-in-the-settings-row).
