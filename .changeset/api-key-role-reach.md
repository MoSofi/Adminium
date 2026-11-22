---
'@adminium/server': patch
---

Security fix: creating an API key can no longer reach above the person or key creating it. Before this release, anyone with the "Manage API keys" permission could give a new key any role, including Super Admin, and then act with that role. Now a key can be given only a role whose permissions its creator already holds, including that role's limits on columns and rows. Only a signed-in Super Admin can create a Super Admin key. A key that creates a key is held to its own permissions and to those of the person who made it, it cannot outlast the key that made it, and a key with no person behind it can no longer create keys. A key also no longer gets past a rule that a change may not be made by a certain person when that person made the key. Keys that already exist keep their role and otherwise keep working, so if a custom role has held "Manage API keys", review your API keys and revoke any you do not recognise.
