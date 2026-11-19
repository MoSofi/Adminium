---
'@adminium/server': patch
---

Milo can draft live chat replies again. Every draft ended in "Milo could not write a draft" with a real AI service, because the request asked for a setting the AI clients refuse; the same was true of Milo's first draft of a landing page. Both now ask the way the clients accept, and when a call to the AI service fails, the server's log says why (the service, the kind of failure and its status, never the conversation or a key).
