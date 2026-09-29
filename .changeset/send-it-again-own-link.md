---
'@adminium/server': patch
'@adminium/manifest': patch
---

A guest can ask for a confirmation email again from the row's own link. An app puts `newLink` on a row's own-link entry and names another link of the same row, such as the link in a "Confirm your order" email, the outbox message that carries it, and optionally `when`, the conditions the row must meet. `POST /public/records/{ref}/{id}/new-link` then makes that link again, so the old one stops opening anything. The email goes to the row's own address and never to an address in the request, and the link the guest asked from keeps working. It is limited to 5 a day per row and one a minute. When the row does not meet `when`, the ask is refused with `409 PUBLIC_WRITE_REFUSED`, and nothing is sent or counted. `when` also works on the signed-in "Make a new link".
