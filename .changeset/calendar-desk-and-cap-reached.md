---
'@adminium/server': patch
---

Staff on screens-only roles can now use their calendar: busy times, clashes, "Keep it", their calendar choices and their private feed link. The desk can also read how many minutes of the last hour a table's public form was refused because its key's hourly limit was full. The built-in demo calendar exists only when `NODE_ENV` is exactly `test` or `development`, so a server with `NODE_ENV` unset does not have it.
