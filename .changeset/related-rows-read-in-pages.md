---
'@adminium/dashboard': patch
---

Opening a record's edit form no longer asks the server for more related rows than it answers at once (it was refused with "limit too high"); a long list of lines is read a page at a time.
