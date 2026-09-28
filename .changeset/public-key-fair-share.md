---
'@adminium/server': patch
---

A handful of strangers can no longer switch a venue's public pages off. A browser key's reads and writes are also counted for every visitor together, and a few addresses could spend that count for everyone: sixty writes to a page that does not exist, from three addresses with no sign-in, and for the rest of the minute a signed-in guest cancelling their own order, or a new guest ordering, was told "Too many requests". Now:

- A request that is refused — an unknown page, a missing record, a filter or a change the rules refuse — no longer counts against every visitor together; it still counts against the address that sent it. A change that reached the database and lost a race (a 409) still counts.
- One address may use at most a twelfth of a key's reads and writes in a minute: 250 reads and 25 writes, well above the 120 reads and 20 writes one visitor was already allowed. A staff screen (a kiosk) counts by the staff member signed in on it, not by the address every patient shares.
- The key's reads for every visitor together go from 600 to 3,000 a minute, and its writes from 60 to 300, so a busy on-sale or lunch rush is not refused.

Replies to a request made with a sign-in, an order's own link or a shared link, and every reply to a change, now carry `Cache-Control: no-store`, so a browser on a shared machine (a kiosk, a hotel lobby) keeps no copy of a person's name, address or phone. Pages anyone may read are cached as before.
