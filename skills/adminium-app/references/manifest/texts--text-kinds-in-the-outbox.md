<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts — Text kinds in the outbox; do not edit -->

# Manifest spec: Texts — Text kinds in the outbox

### Text kinds in the outbox

| Field | Rule |
|---|---|
| `outbox.channels` | `{ "<kind>": "sms" }`: the kinds sent as texts. A kind not named is email. A text kind's template (`kinds`) is one of `textTemplates`. It may name no `purposes`, `surveyLinks` or `reviewLinks`, and its producers no `recipient` or `replyTo`. |
| `outbox.recipient.phone` | A `text` column of the person's table that holds their mobile number, marked personal (`"rules": { "personal": true }`). Required when any kind is a text. An outbox whose every kind is a text may leave out `recipient.email`: a person known only by phone. |
| `outbox.recipient.fallback.phone` | The number on the row the fallback link points at, for a person not yet on file. Needs `recipient.phone` too. |
| `outbox.waiting` | Up to 16 text kinds a customer is waiting for right now ("your order is ready"). They may go outside the business's sending hours. Only a `service` text kind can be one. |
| `outbox.recipient.textPhone` | `{ "via": "<outbox column>", "column": "<text column>" }`: text kinds go to the number on the row `via` links (an order's `mobile`, the number the person typed with the order's box), instead of the person's own. Consent and the stop list are judged for that number. A row that holds none: the person's own number. Needs Adminium 0.3.76. |
| `outbox.columns.textReason` | A `text` column (40 characters or more) that Adminium fills, beside the sentence in `error`, with one code for each text row: `queued`, `waiting`, `sent`, `unknown`, `no-number`, `not-set-up` (no provider, no sender, or texts switched off), `no-consent`, `stopped`, `opted-out`, `unconfirmed-consent`, `daily-limit`, `sample`, `rehearsal`, and the other reasons a text is not sent. Read it instead of the sentence. Needs Adminium 0.3.76. |
| `outbox.settings.textName` | A `text` column of the settings table: the name automatic texts give the business by (the "not read" answer, a STOP's confirmation, a country's opt-out line), such as a neutral name for a clinic. Empty: the sender name set in Studio → Texts, else the business's name. The name the emails are signed with (`settings.name`) is never used in a text. Needs Adminium 0.3.76. |

Every text kind has a class in `classes`, `service` or `marketing`. A `service` text needs the
person's yes to service texts, a `marketing` one their yes to marketing texts. See
[Consent, STOP and the do-not-text list](https://docs.adminium.dev/guides/texts/stop-and-consent/).

A row with a number and an empty address is a person who can be texted. A text kind on a row with no
number is skipped with "No mobile number on file". The language follows the outbox's own rules: the
row's or the person's `language`, else the install's.

An add-on's outbox sends email only: an add-on may not use `channels`, `waiting` or a phone.
