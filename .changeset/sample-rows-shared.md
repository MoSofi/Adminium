---
'@adminium/server': patch
---

Sample data on a table two apps share: when another installed app's sample already put the same row there (the same label, the same values, still as that sample wrote it), an app's sample now takes that row as its own instead of writing it again. A copy of an app beside its original, or two apps on one menu, show each sample dish once, and the second app's sample orders are of the dishes already there. Removing one app's sample leaves such a row for the other; the last app that lists it removes it. A row that differs, or that was changed since, is left alone and the app writes its own.
