---
'@adminium/server': patch
---

A host mapped to the add-on pages no longer takes one of a door's own calls as its home page. Under each `/x/` door (forms, chat) only a page one name below the door is a home (`/x/forms/newsletter`, `/x/chat/<add-on>`); the door itself, its `api`, and anything deeper are refused with `invalid_home`.
