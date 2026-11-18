---
'@adminium/server': patch
'@adminium/dashboard': patch
---

The live chat's visitor side. A website shows the chat with one line, `<script src="<public address>/x/embed.js" data-adminium-chat="<add-on>" async></script>`: the loader draws a button and opens the chat window (`/x/chat/<add-on>`) in a frame, only on the websites listed under "Your websites". The window's calls are under `/x/chat/api/<add-on>/` (its words, a human check, start, messages, details, the poll), held to per-address and per-hour caps, a breaker that pauses new chats past 500 an hour, and a token that lapses after a day without a message. Outside hours a visitor may leave a question with an e-mail address, which becomes a row of the table an app opens to the chat. Automatic answers come from the owner's own answers only, within a daily token limit.
