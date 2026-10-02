<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md; do not edit -->

# An app's emails

An app that sends email, such as booking confirmations or visit reminders, keeps them in a table
of its own: the **outbox**. Every email is a row there. Adminium adds rows when something happens,
sends the queued ones, and writes the outcome back on each row. The outbox is the log a person
reads to see what went out, to whom, and why something did not.

The app declares its outbox and its templates; the fields are in the
[manifest reference](https://docs.adminium.dev/reference/manifest/#emails).

Email has to be set up on the server: an SMTP relay and a sender under
**Studio → Settings → Email** (see [Senders](https://docs.adminium.dev/guides/email/#senders)). Without it, the install's
table check warns "Email is not set up", and every queued row fails with "Email is not set up on
this server".
