<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Attachments; do not edit -->

# An app's emails: Attachments

A template can carry a document, such as the invoice with the invoice email or a receipt with a
payment's. It is drawn for the row the message is about when the message is sent. A message
whose document cannot be drawn fails, with the reason, rather than going without it.

### A document the email may go without

A hotel's payment email can carry a receipt when the hotel uses **Invoices & Receipts**, and still
thank the guest when it does not. The template says the document is optional, and marks the
paragraphs that only make sense beside it:

```json
{
  "key": "wren-stay-paid",
  "name": "Payment received",
  "attach": { "kind": "receipt", "link": "stay", "optional": true },
  "locales": {
    "en-US": {
      "subject": "Payment received",
      "blocks": [
        { "block": "email.text", "data": { "text": "Thank you. We have received {{stay.total}}." } },
        { "block": "email.text", "data": { "text": "Your receipt is attached.", "withAttachment": true } }
      ]
    }
  }
}
```

The message goes without the document, and without every block marked
`"withAttachment": true`, only while no add-on that draws receipts is attached to the app and
switched on. Every other reason the document is missing (its profile switched off, a drawing that
failed, a file too large to send, an add-on that is there but draws nothing for this row) still
fails the message, with the reason: an attached add-on that is late or failing never turns into a
quiet email without its receipt. `withAttachment` is allowed only on a template whose `attach` is
optional.
