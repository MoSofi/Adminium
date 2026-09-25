---
'@adminium/server': patch
---

An app's email is no longer sent with a `{{…}}` placeholder in it. A template that named a value nothing fills (a secret column, a personal column of a linked row, a link the message does not have, a misspelt name) went out with the placeholder printed as written, so a client could get "Open the handover: …#{{project.share_token}}". Such a message is now marked failed, and its error names the variable, for example "Not sent: nothing fills {{project.share_token}}". Adminium's own emails and test sends are unchanged.
