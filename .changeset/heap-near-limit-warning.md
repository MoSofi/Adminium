---
'@adminium/server': patch
---

The server says in its log when its JavaScript heap is nearly full, with the setting that gives it more (`NODE_OPTIONS=--max-old-space-size=512`), and writes an hourly `memory` line. On a machine or container with 1 GB or less, Node.js allows a heap of about 259 MB, and a started server already uses about 240 MB of it.

The Docker image now sets `NODE_OPTIONS=--max-old-space-size=512` (the server holds about 245 MB of heap from boot; a machine with 1 GB or less gave Node a ~256 MB ceiling). Memory guidance: 2 GB, or 1 GB with swap, on a server you run yourself; 1 GB for a managed container (the Fly, App Platform and Render files now ask for it); 512 MB is not enough.

**Before you upgrade:** a container held to 512 MB (`mem_limit: 512m`, a 512 MB plan) must be raised to 1 GB FIRST. The image now lets the heap grow to 512 MB on its own, so in a 512 MB container the kernel kills the server before Node's own out-of-memory error, and nothing reaches the log. If you set your own `NODE_OPTIONS`, it replaces the image's: keep `--max-old-space-size=512` in it.
