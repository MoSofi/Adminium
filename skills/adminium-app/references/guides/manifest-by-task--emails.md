<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Emails; do not edit -->

# A manifest, task by task: Emails

`emails.json` holds `outbox` and `emailTemplates`. The app declares a table of its own as the
outbox, says what queues a row in it (a job created, a status changed to `done`), and ships the
templates those rows are sent with. Adminium sends them through the operator's own mail settings;
the app never talks to a mail server. The outbox table has columns Adminium writes itself, so
follow [An app's emails](https://docs.adminium.dev/guides/apps/emails/) step by step rather than writing it from memory.

Reference: [Emails](https://docs.adminium.dev/reference/manifest/#emails).
