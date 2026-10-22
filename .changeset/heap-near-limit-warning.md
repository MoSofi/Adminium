---
'@adminium/server': patch
---

The server says in its log when its JavaScript heap is nearly full, with the setting that gives it more (`NODE_OPTIONS=--max-old-space-size=512`), and writes an hourly `memory` line. On a machine or container with 1 GB or less, Node.js allows a heap of about 259 MB, and a started server already uses about 240 MB of it.
