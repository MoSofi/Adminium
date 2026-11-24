<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Texts — textTemplates; do not edit -->

# Manifest spec: Texts — textTemplates

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
