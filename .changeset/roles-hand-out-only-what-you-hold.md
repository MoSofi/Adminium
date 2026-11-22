---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
---

Security fix: somebody who manages roles and is not a signed-in Super Admin can now give out only what they hold themselves, and can no longer edit roles above them. Before this release, anyone with "Manage roles" could copy Super Admin's permissions into a new role, widen any role, or give themselves a higher one. Now creating, copying or editing a role can set only permissions the person fully holds, including limits on columns, values and rows. They cannot rename, change or delete a role that holds more than they do, and cannot give that role to anybody or take it from anybody, themselves included. An API key that manages roles is held to its own permissions and to those of the person who made it. A signed-in Super Admin can still do everything. Roles, the people who hold them and API keys that exist today are not changed, so if a custom role has held "Manage roles", review who holds which role. The Roles and Team pages show what you cannot give as unavailable and say why.
