---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
---

Security: somebody who manages roles and is not a signed-in Super Admin can give out only what they hold themselves, and cannot edit roles above them. Creating, copying or editing a role can set only permissions the person fully holds, including limits on columns, values and rows. They cannot rename, change or delete a role that holds more than they do, and cannot give that role to anybody or take it from anybody, themselves included. An API key that manages roles is held to its own permissions and to those of the person who made it. A signed-in Super Admin can do everything. Roles, the people who hold them and API keys that exist today are not changed, so if a custom role has held "Manage roles", review who holds which role. The Roles and Team pages show what you cannot give as unavailable and say why.
