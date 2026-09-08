---
'@adminium/widgets': patch
'@adminium/i18n': patch
---

**The generated chat page answers as itself, and stays live.** Two defects on
the one page whose whole purpose is replying to somebody.

A staff reply stamped **no author**. The composer's insert wrote the body and
the conversation key and nothing else, so nothing came back for the page's own
"is this mine" check to match — and every message an operator sent rendered on
the *other* side of the thread. The send now stamps the signed-in user's e-mail
into whichever author column the table has.

`toChatMessages` also reads a **sender-kind** column, where the table has one,
*before* falling back to matching the author's name. That ordering is the
security half: an author name is writable by an anonymous visitor through the
public surface, and without it somebody typing a support agent's address into
their own name field would appear on the agent's side of the agent's own inbox.
A sender kind is stamped server-side and cannot be. The detection vocabulary is
deliberately the narrowest in the module — `role`, `type`, `direction` and
`kind` are all refused, because this column decides which side of a thread a
bubble lands on and a false positive would re-side an app's whole history.

The page also **subscribes** to its two tables' live channels now. It always
claimed to; the invalidation map did fire on such an event, but nothing had
opened the channel, so the frames went to a socket the page was not on. Both
tables, because the two halves move on different writes: a message moves the
thread, and the same exchange moves the rail's preview, timestamp and unread
count.

Studio's scope editor documents the two `$generate` sentinels under the scope
document field, in all eight locales.
