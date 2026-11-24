<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts; do not edit -->

# Manifest spec: Texts

An app can send text messages (SMS) through the business's own Twilio or Telnyx account. Every word
below needs Adminium 0.3.76 or later: a manifest that uses one sets
`compatibility.minAdminiumVersion` to `0.3.76`, and an older server refuses it with a message that
names the word. For what the business sees, see [Set up texts](https://docs.adminium.dev/guides/texts/).

A text is a template of its own, never an email template with fields left empty. One outbox kind
has one channel, so "email and text" is two kinds. A text kind is queued, logged and sent through
the same outbox as an email, and the send path checks consent, the do-not-text list, the country,
the words, the length, the sending hours and the daily limit for every text.

```json
"textTemplates": [
  { "key": "clinic-reminder-text", "name": { "en-US": "Visit reminder", "de-DE": "Terminerinnerung" },
    "locales": {
      "en-US": { "body": "{{practice.name}}: your visit is at {{appointment.starts_at.time}}." },
      "de-DE": { "body": "{{practice.name}}: Ihr Termin ist um {{appointment.starts_at.time}}." } } },
  { "key": "clinic-ready-text", "name": "Doctor ready",
    "locales": { "en-US": { "body": "{{practice.name}}: the doctor is ready for you now." } } }
],
"outbox": {
  "recipient": { "via": "patient_id", "table": "patients", "email": "email", "phone": "mobile" },
  "kinds":    { "reminder_text": "clinic-reminder-text", "ready_text": "clinic-ready-text" },
  "channels": { "reminder_text": "sms", "ready_text": "sms" },
  "classes":  { "reminder_text": "service", "ready_text": "service" },
  "waiting":  ["ready_text"]
},
"textReplies": "off"
```

In a project folder, `textTemplates` and `textReplies` are written in `manifest/emails.json`, beside
`outbox` and `emailTemplates`.

### textTemplates

Up to 32 templates.

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case, up to 80 characters, starting with the app's key and a dash (`clinic-`). Unique, and never also an email template's key. |
| `name` | yes | One text, or one per language. |
| `locales` | yes | Each language's `{ "body" }`, `en-US` always among them. A body holds 1 to 1,000 characters, with placeholders as an email's (`{{appointment.starts_at.time}}`, `{{name\|there}}`). |

Do not write the opt-out line. Adminium adds it after the placeholders are filled, in the template's
language: "Reply STOP to opt out." from a number that can take replies, or "To stop these texts,
contact" and the business's phone or e-mail otherwise: the outbox's `settings.phone`, else its
`settings.replyTo` address. With neither, a text from a sender that cannot take replies is not
sent. A template that says
STOP itself gets no second line, and from a sender name its "Reply STOP" sentence is taken out.

A template is refused at install, on save and again at every send when it:

- reads a sign-in link, a link made for one person (`survey_link`, `reviewLink`, a stop link, an
  object link, a calendar link), a column the app declares as a code, a QR value, or a placeholder
  whose name ends in `code`, `otp`, `pin`, `password`, `token` or `secret` (`postal_code`,
  `country_code` and other harmless codes are allowed);
- asks the person to reply YES, in any of the eight languages;
- lists rows (`{{row.…}}`), or holds a broken placeholder.

A placeholder with no value stops the text unless it has a backup. A text over 6 segments is never
sent; see [the length counter](https://docs.adminium.dev/guides/texts/templates/#the-length-counter).

The install marks each row as the app's, with a hash of what it shipped. An owner's edit survives
the app's updates and its removal. An update removes the app's unedited rows of a template it no
longer ships.

### Text kinds in the outbox

| Field | Rule |
|---|---|
| `outbox.channels` | `{ "<kind>": "sms" }`: the kinds sent as texts. A kind not named is email. A text kind's template (`kinds`) is one of `textTemplates`. It may name no `purposes`, `surveyLinks` or `reviewLinks`, and its producers no `recipient` or `replyTo`. |
| `outbox.recipient.phone` | A `text` column of the person's table that holds their mobile number, marked personal (`"rules": { "personal": true }`). Required when any kind is a text. An outbox whose every kind is a text may leave out `recipient.email`: a person known only by phone. |
| `outbox.recipient.fallback.phone` | The number on the row the fallback link points at, for a person not yet on file. Needs `recipient.phone` too. |
| `outbox.waiting` | Up to 16 text kinds a customer is waiting for right now ("your order is ready"). They may go outside the business's sending hours. Only a `service` text kind can be one. |

Every text kind has a class in `classes`, `service` or `marketing`. A `service` text needs the
person's yes to service texts, a `marketing` one their yes to marketing texts. See
[Consent, STOP and the do-not-text list](https://docs.adminium.dev/guides/texts/stop-and-consent/).

A row with a number and an empty address is a person who can be texted. A text kind on a row with no
number is skipped with "No mobile number on file". The language follows the outbox's own rules: the
row's or the person's `language`, else the install's.

An add-on's outbox sends email only: an add-on may not use `channels`, `waiting` or a phone.

### textReplies

`"on"` or `"off"`: whether staff read the texts customers send back to this app. Absent means `on`.

With `off`, a reply is not kept at all, and the sender gets one fixed answer: "This number is not
read. Contact us:" and the business's phone or e-mail, in the business's language, at most once in 30
days. Use it for an app whose customers may write what nobody should hold in a shared inbox, such as
a clinic's patients writing symptoms. It is where the switch starts: the owner can turn it either way
after the install, and their choice stands across updates. See
[Conversations and replies](https://docs.adminium.dev/guides/texts/conversations/).

### Conversations for an app's roles

A customer's reply can say anything, so nobody but the Super Admin reads conversations until given
the right. An app's role can be given its own app's conversations:

```json
"roles": [{ "key": "front-desk", "name": "Front desk",
            "permissions": ["table:@guests:read", "texts:@:read", "texts:@:reply"] }]
```

| Grant | What it allows |
|---|---|
| `texts:@:read` | Read this app's conversations. |
| `texts:@:reply` | Read and answer them, and text the number on a record of this app the person can open. |

`@` is this install. The grants need Adminium 0.3.76 or later. Every read and answer is audited. An
API key never reads or answers a conversation.
