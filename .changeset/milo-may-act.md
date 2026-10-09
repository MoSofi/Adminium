---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/llm': patch
'@adminium/i18n': patch
---

The assistant can now do things, when the workspace lets it and a person says yes. Settings → AI has four switches: Create, Change, Send, Delete. All four are off on a new install; a workspace that was already in use keeps Create on, so its assistant goes on saving drafts as it did. A new field sets how many changes one confirmation may make (1 to 50).

With a switch on, and only for something the signed-in person could do by hand, the assistant proposes: add, change or delete rows of the page they are on (from a screen with no page of its own, of a table they name), save a draft as a new document, save it over the open one, delete a document, send a campaign to roles. Nothing is written by a proposal. The server first tries it as that person, through the same routes the screens use, and the panel shows a card with exactly what would happen as they read the data: old and new values, what refers to a row that would be deleted, who would get a mail, and what cannot be done and why. One click confirms what is ticked; the page's own undo is offered for its minute. A proposal is confirmed once, is let go when something else is asked or after thirty minutes, and is checked again at the confirm: if a row moved or a switch was turned off meanwhile, nothing is written and the card shows what changed.

The audit log marks an entry that was confirmed through the assistant ("through Milo"), on the row and in its details, and a rule set off by such a change carries the mark on what it writes.

The "Enable actions" switch in the panel is gone: what the assistant may do is the workspace's setting, not a button per visit. Saving a draft and adding a language of one now need Create.

A campaign that is switched off cannot be sent by the assistant, and a send is always a proposal of its own. Personal columns still never reach the model; a change to one is shown to the person as the value they gave.
