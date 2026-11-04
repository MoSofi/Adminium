---
'@adminium/server': patch
---

A read that opens one row by its own code (`unlockBy` with `self`), by a session the app signed in, may show the personal columns it selects when the code is 16 characters long: 80 bits of secret, as hard to find by trying as a shared link's. A shorter code, or a code of another row that unlocks this one, still shows none, and an entry that selects a personal column there is refused where it is written.
