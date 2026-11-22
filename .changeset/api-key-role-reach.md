---
'@adminium/server': patch
---

Security: an API key holds at most what the person or key creating it holds. A key can be given only a role whose permissions its creator already holds, including that role's limits on columns and rows. Only a signed-in Super Admin can create a Super Admin key. A key that creates a key is held to its own permissions and to those of the person who made it, it cannot outlast the key that made it, and only a key with a person behind it can create keys. A rule that a certain person may not make a change also holds for the keys that person made. Keys that already exist keep their role and otherwise keep working, so if a custom role has held "Manage API keys", review your API keys and revoke any you do not recognise.
