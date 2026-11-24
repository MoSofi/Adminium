---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Adminium can send text messages (SMS) through the business's own Twilio or Telnyx account. The owner connects the account on Studio → Texts, where the keys are checked when saved, and sets the sender, the daily limit and the sending hours. Apps bring their own text templates (`textTemplates`), and an outbox kind can be sent as a text (`outbox.channels`). An automation can send one with the new "Send text" step. Every text is checked when it goes: the person's own yes to texts, kept apart from e-mail consent, the do-not-text list, the country, its words and length, the sending hours and the daily limit. No text carries a sign-in link or a code, and none goes to mainland China (+86). A STOP reply, in any of eight languages, stops every text from the business and gets one plain confirmation. A text from a sender name gives the business's phone or e-mail for stopping instead. Erasing a person also erases their texts, and a person known only by phone can be erased by number. Marketing texts need their own yes, confirmed first in Germany, go only from a number on a server that receives STOP, and never go to a found lead or to a country where nobody can reply. Customers' replies can be read and answered on a Texts page, by the roles given that right, and each app can switch its replies off (`textReplies`).
