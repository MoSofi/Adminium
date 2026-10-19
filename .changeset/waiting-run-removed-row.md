---
'@adminium/server': patch
---

A rule waiting out its minute after a change no longer acts on a different row. When a row was changed and then removed inside that minute, the rule's run used to start anyway, and on SQLite it found the next row made, which is given the same number: a deal marked won and removed at once made a job for the deal made after it. Removing the row now drops its waiting runs, as an undo does; a rule that runs on the removal itself still runs.
