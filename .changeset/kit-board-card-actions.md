---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

A card on the kit's board can carry actions of its own: `actions` on a card and `onAction` on the board give it a small "more" button, after the card in the Tab order, that opens them as a menu (arrows, Enter or space, Escape back to the button). The button is no part of the card, so it never starts a drag, and the menu is not cut off by a long column. With `onOpen`, Shift+Enter now opens a card that Enter picks up, and a screen reader is told so. A column can carry a `badge` after its heading. A card's "draggable card" is now said in the reader's language, on the dashboard's own boards too.
