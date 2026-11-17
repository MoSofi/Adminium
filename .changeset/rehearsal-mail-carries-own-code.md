---
'@adminium/server': patch
---

A rehearsal's e-mail may now carry the rehearsed row's own link to the person rehearsing. Before, every app e-mail carrying an order's link (`{{order.link_token}}`) failed during a rehearsal with "is a code, and goes only to the address on file of the person it belongs to". A code goes to them only when the message is a rehearsal's, is addressed to them alone, is marked `[TEST]`, and the row was made in their own rehearsal and is still a sample row. A real customer's row is never one: a message addressed by hand to the person rehearsing about a real order, a row whose rehearsal note outlived it, or a row another person rehearsed never has its code mailed to them.
