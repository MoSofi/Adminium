---
'@adminium/server': patch
'@adminium/meta': patch
---

Three new notification kinds for the live chat: `chat.waiting` (a visitor is waiting for a person), `chat.paused` (new chats were paused for an hour after too many started) and `chat.budget` (the day's automatic answers are used up). `chat.waiting` goes to the bell only until each person turns its e-mail on, so one waiting chat never mails every reader. Two meta migrations come with the chat: `0094` keeps the automatic answerer's daily tally, and `0095` keeps its per-address marks (hashed, kept three hours).
