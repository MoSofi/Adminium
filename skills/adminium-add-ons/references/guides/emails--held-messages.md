<!-- produced from apps/docs/src/content/docs/guides/apps/emails.md § Held messages; do not edit -->

# An app's emails: Held messages

Some emails should not go by themselves: a reminder that an invoice is overdue is read first. An
app can make such a message **held**. It is written with the day it comes due, and nothing is
sent until a person approves it.

- **Approve** a held message and it becomes `queued`. You may reword it first, its subject and its
  text, which is then sent as plain paragraphs in place of the template's. Who approved it is
  recorded. One approved before its day, or with no day worked out, goes at once.
- **Skip** a held or queued message: it becomes `skipped`, with the reason "by hand".
- **Queue again** a failed one.

Once a minute Adminium looks over the waiting messages. It moves a message's day when what it is
counted from moves (a new due date), skips the ones no longer needed (the invoice paid or voided),
and skips an earlier reminder once a later one of the same series has come due, so an invoice
never has two reminders ready at once. It asks all of this again just before a message goes. A
held message is written even with no address on file: the address is looked up when it is
approved and again when it is sent.

A message can also change a row once it has gone, such as marking a project paused. That change
is an ordinary write, held to the row's rules; if it is refused, the message records why.
