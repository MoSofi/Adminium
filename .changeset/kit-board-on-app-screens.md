---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The board can be mounted on an app's own staff screen: `mount('board', element, props)`. The screen gives columns and cards as plain data and saves a move in `onMove`; a save it answers `{ refused }` (or rejects) puts the card back and says the reason on the board and to a screen reader. Cards move by mouse or by keyboard, right to left where the language is, and the columns scroll sideways inside the board on a narrow screen. A card can carry a subtitle, a figure, plain and labelled lines, a tag, an owner and a reference, all as text the app has written. The kit's styles need no Tailwind on the app's page and style nothing outside the kit's own wrapper. `kit.styles` in the staff side's `surface-config.json` is now a list of every sheet of the kit (it was one name or `null`).
