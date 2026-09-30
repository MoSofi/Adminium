---
'@adminium/server': patch
---

Removing an app's sample data no longer strips the lines from a sample record
your own records use. A removal keeps the sample rows your records point at,
but it deleted the rows locked with them: when you had sent a proposal on
Client Portal's sample terms, the terms stayed and their clauses went, so the
proposal's terms lost their text. Adding the sample again then wrote the
clauses back under terms that can no longer change, and the lock refused the
whole add, saying the clauses cannot change while their terms version is in
force. Client Portal's sample could never be added again.

A kept row now keeps the rows its lock ties to it: a document's lines, a
terms version's clauses. When the sample is added again, the record comes back
with the lines it has, and the sample writes no lines under it, whatever its
own lines read as today (added by someone in another language, say). A line
you changed stays yours. Changing a locked row is refused as before.

Clauses deleted by a removal before this release cannot be restored. Adding
the sample again over those terms now works, and writes no clauses under them.
