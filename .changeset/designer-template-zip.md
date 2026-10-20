---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The Designer takes a whole site template: drop a `.zip` (or a folder, which the page packs into one) on the message box. It goes up at once; the chip shows the template's pages and files, and a "left out" list says why each file was not kept (PHP, videos, a link…). Send waits for the upload. A second template asks before it replaces the first. The server reads the zip with its own strict reader and refuses a zip that could be read two ways, a zip locked with a password, names that clash or that Windows cannot hold, and anything past the limits (25 MB packed, 1,000 entries, 300 files and 24 MB kept), each in one sentence naming the file. The model is told only the template's counts and reads its files with `read_attachment`, as data. A file can now be taken off a message before it is sent; one that went with a message stays. One person's Designer files are capped at 500 MB across sessions.
