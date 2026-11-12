---
'@adminium/server': patch
'@adminium/meta': patch
---

A server starts lighter. The built-in email templates are seeded once per release and per change to the translations, not on every start, which kept every language's words in memory: about 23 MB less heap and up to half a second off each start. In the Docker image the comments are taken out of Adminium's own built code (the npm package keeps them), since the engine holds the source of every module it loads: about 18 MB less heap per container. A trial no longer asks adminium.dev for its lists each time it starts; the daily refresh and the Add-ons page still do. The heap watch now also reads the container's memory limit (cgroup v1 or v2, or a systemd `MemoryMax`) and warns when the server comes within an eighth of it, naming the memory the container needs, and its hourly `memory` line names the limit.
