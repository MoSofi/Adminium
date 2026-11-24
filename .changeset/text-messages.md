---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Adminium can send text messages (SMS) through the business's own Twilio or Telnyx account. Adminium holds no account, buys no numbers and takes no money. The owner connects the account on Studio → Texts, where the keys are checked when saved, and sets the sender, the daily limit and the sending hours. The same page shows the reply address to give the provider; replies count as arriving only once the first signed one has.

Apps bring their own text templates (`textTemplates`), and an outbox kind can be sent as a text (`outbox.channels`), to the person's number or to a number on the row itself (`outbox.recipient.textPhone`), with a reason code an app can read (`outbox.columns.textReason`) and the name automatic texts use (`outbox.settings.textName`). An automation can send one with the new "Send text" step.

Every text is checked when it goes:
- the person's own yes to texts for that app, kept apart from e-mail consent;
- the do-not-text list;
- the country;
- its words and length;
- the sending hours, in the destination's time zones when the business has none;
- the daily limit.

No text carries a sign-in link or a code, and none goes to mainland China (+86).

Consent works like this:
- Each form can carry an unticked text consent box (`publicAccess.textConsent`), Forms-add-on forms included, and a staff tick, or `POST /texts/consent`, records a yes with its wording.
- A STOP reply, in any of eight languages, stops every text from the business and gets one plain confirmation.
- A text from a sender name gives the business's phone or e-mail for stopping instead.

Erasing a person also erases their texts. A shared number keeps the other people's consent. A person known only by phone can be found, exported and erased by number.

Customers' replies can be read and answered on Studio → Texts → Conversations by the roles given that right, every read and reply is audited, and each app can switch its replies off (`textReplies`).

Marketing texts (runs to people who said yes to them, double opt-in in Germany) are built but not yet available in this release: every marketing text is refused until their wording has been reviewed.
