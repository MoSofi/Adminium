<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — An email that is not sent; do not edit -->

# Error codes: Codes met outside a request — An email that is not sent

### An email that is not sent

An email is never sent without its list. When the table or link an [email that lists
rows](https://docs.adminium.dev/reference/manifest/#emails-that-list-rows) reads is gone (after a rename, say), the outbox
row is marked `failed` with the sentence "Not sent: the email lists rows from a table or link that
is not there" in its error column. This is text on the row, not an HTTP code. An empty list still
sends. The other sentences are in [app emails](https://docs.adminium.dev/guides/apps/emails/#sending).
