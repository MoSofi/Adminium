---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium Designer's build page: the chat with the Designer, drawn from the session's events as they stream (and read again after a gap or a reconnect, so a reload shows the same thing). Each turn shows the person's message, the Designer's answer, its steps (files written one after another folded into one line, the time it took), the tokens used while it works, and "Saved as" a version. Questions, a data loss and a package wait for an answer on cards; a stopped turn offers Continue and Put the files back; a limit offers Keep going; a failed model says which and offers Try again. The top bar renames the app and lists its versions; going back to one asks first and adds a version on top. The chat's width can be dragged or moved with the arrow keys; on a phone, chat and preview are tabs. Step lines are now worded on the page in each language from facts the server sends with every step.
