---
'@adminium/add-on-contracts': patch
'@adminium/dashboard': patch
'@adminium/server': patch
---

Two additions to the data kit an add-on's pages use (`host.data`), each absent on an older Adminium, so a page checks for it first. `useLiveTable(table, { enabled? })` follows one of the add-on's own tables: whenever a row of it is written, by anybody and through any door, the page's lists and rows of that table are read again. Forms answers are now published on the live channel too, so a forms add-on's answers list can follow new answers. `openAssistant({ prompt? })` opens the assistant's panel beside the page, with the prompt in its box for the person to send; it returns false, and opens nothing, for someone who may not use the assistant.
