<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails; do not edit -->

# Manifest spec: Emails

An app declares the emails it sends with two blocks: `outbox`, which names one of its tables as
the outbox and says what queues rows in it, and `emailTemplates`, the templates those rows are
sent with. For a walk-through, see [Emails](https://docs.adminium.dev/guides/apps/emails/).

The outbox table is the log. Every email is a row in it, queued by a producer below, by the app's
own screens or by the operator. Adminium sends queued rows and records the outcome on each:
`sent` once the message is handed to the mail queue, `skipped` when there is nothing to send to
("No email on file", or a reserved example address), and `failed` with a reason. A row already
there for the same kind and source is what stops a second send.
