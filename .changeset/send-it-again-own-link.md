---
'@adminium/server': patch
'@adminium/manifest': patch
---

A guest can ask for a confirmation email again from the row's own link. An app puts `newLink` on a row's own-link entry. It names another link of the same row (such as the link in a "Confirm your order" email), the outbox message that carries it, and `when`, the conditions the row must meet. `when` is required here. `POST /public/records/{ref}/{id}/new-link` then makes that link again, so the old one stops opening anything, and the link the guest asked from keeps working. The email goes where the message's own producer sends it, read from the row, and never to an address in the request. The app may not let a guest change that address.

The new code and its email are saved together. When the email cannot be queued, nothing changes and the old link still works. Asks are limited to 5 a day per row and 5 a day per mailbox across the table, and one a minute per row. An ask over a limit, while the row does not meet `when`, or while that link is stopped is refused with `409`, and nothing is sent or counted. `when` also works on the signed-in "Make a new link".
