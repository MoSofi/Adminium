<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Sending; do not edit -->

# An app's emails: Sending

Queued rows go right after they are queued, and a pass every minute picks up any left behind, for
example after a restart or when you queue one yourself. Each row is sent:

- **to the row's address.** A row with none, such as one the desk queued with the patient linked
  but not their email, goes to the address the producers would have used: the person the row
  links, else what the linked visit carries for a first visit. The address, and the language
  found with it, are written into the row once it is sent. The person's reminder opt-out is not
  asked here: it only stops the producers;
- **in the row's language,** when it is one Adminium speaks, else the workspace's. A template
  with no version in that language is sent in US English. Another language picks the nearest one
  Adminium speaks (`en-GB` gets the US English email), and its dates, times and money are still
  written the recipient's way (`en-GB` reads "09:30", not "9:30 AM");
- **on the venue's clock:** the time zone of the app's connection, or UTC when none is set;
- **in the connection's currency** for money, or the row's own when it has a `currency` column
  holding a three-letter code;
- **with a Reply-To** when the app names one ([below](https://docs.adminium.dev/guides/apps/emails/#replies)).

Then the row's status changes, with a sentence in its error column:

| Status | Sentence | What it means |
|---|---|---|
| `sent` | none | Handed to the mail queue. **Sent at** is filled in. |
| `skipped` | No email on file | There is no usable address, on the row or on the person it links. |
| `skipped` | A reserved address (for examples and tests) | The address is on `example.com` or another name kept for examples: `example.*`, `.example`, `.test`, `.invalid`, `.localhost`. Sample records use these. |
| `failed` | No email is set for "*kind*" | The kind has no template. |
| `failed` | The email is switched off, or has no text | The template, in that language, is a draft or archived. |
| `failed` | The email has an HTML block, which cannot carry what a person typed | Someone added a **custom HTML** section to the template. See [below](https://docs.adminium.dev/guides/apps/emails/#editing-the-templates). |
| `failed` | Email is not set up on this server | Set up email, then queue the row again. |
| `failed` | Not sent: the email lists rows from a table or link that is not there | A list's table, link or column is gone, for example renamed. See [Emails that list rows](https://docs.adminium.dev/guides/apps/emails/#emails-that-list-rows). |
| `failed` | Not sent: {{…}} holds more than a QR code carries (64 bytes) | A code drawn as a QR code is longer than one carries. See [QR codes](https://docs.adminium.dev/guides/apps/emails/#qr-codes). |
| `failed` | Not sent: the values before the change are more than the outbox keeps | See [Messages about changes](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes). |
| `failed` | The email could not be prepared | Something else went wrong; the server log says what. |
| `failed` | Not delivered: *reason* | The mail server refused it for good, after its retries. |

**To send a row again,** set its status back to `queued`. It goes within a minute. A late
report about the earlier message does not touch the new one.

A disabled app's queued rows wait, and go once it is enabled again.

### Replies

A guest who answers a booking email should reach the house, not the server's sender address. An
app names a text column of its settings row as the reply address:

```json
"settings": { "table": "settings", "name": "name", "replyTo": "reply_to" }
```

Every message of the app then carries a `Reply-To` with that address, read when the message goes.
It must be one plain address, of at most 254 characters: an empty column, a list of addresses, a
display name (`Wren House <desk@…>`) or anything else that is not one address means no
`Reply-To` at all, never a message refused.
