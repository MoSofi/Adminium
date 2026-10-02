<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § The outbox table; do not edit -->

# An app's emails: The outbox table

It is one of the app's tables, so you read it like any other: in the app's own screens, or in a
page of the dashboard. Each row holds:

| Column | What it holds |
|---|---|
| Kind | Which email it is, such as a confirmation or a reminder. Each kind is sent with one template. |
| Status | `queued`, `sent`, `failed` or `skipped`, and `held` for a message that waits for a person ([below](https://docs.adminium.dev/guides/apps/emails/#held-messages)). |
| To | The address, copied when the row is queued. |
| Language | The recipient's language, copied when the row is queued. |
| Links | The row it is about: a visit, a person. |
| Due | For a reminder, the moment it leads. |
| Sent at | When it was handed to the mail queue. |
| Error | Why it was skipped or failed, as a sentence. |
| Was | For a message about a change, the values the row held before it ([below](https://docs.adminium.dev/guides/apps/emails/#messages-about-changes)). |
| Repeat key | For a message sent once per value of a column, a digest of that value, never the value itself ([below](https://docs.adminium.dev/guides/apps/emails/#one-message-per-value)). |

The address and the language are copied onto the row when it is queued. A person who changes
their address afterwards changes where the next email goes, not this one.
