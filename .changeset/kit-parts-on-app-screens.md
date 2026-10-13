---
'@adminium/server': patch
'@adminium/dashboard': patch
---

An app's own staff screen can draw one of Adminium's larger parts without bundling it. The server serves the parts as files of its own under `/assets/kit/`, and the staff side's `surface-config.json` names the one to import (`kit.entry`, with the contract's number) beside `maps` (whether maps are on, and where from). A screen imports that file and calls `mount(part, element, props)`, which answers `{ update, unmount }`; the part is drawn by Adminium's own React, in the person's language, with styles held inside its own wrapper. The mention text area is the first part: it stores a person as `@[Name](usr_…)`, as the dashboard's box does. Someone whose roles open only an app's screens gets a plain text box there, since they may not read the people list.
