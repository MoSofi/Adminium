---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Studio → API keys & tokens is rebuilt around endpoints.**

`/studio/public-api` now shows:

- your keys, marked browser or server. Each key lists what it can call. A browser key can be
  revealed, and a key can be revoked after typing its name to confirm.
- the endpoints generated from your schema, with their methods, auth and rate limit.
- a quick-start `curl`.
- the number of requests in the last 24 hours.

"Create key" opens a sheet where you pick endpoints and, under each one, the methods the key may
use:

- select all, deselect all, or a read-only preset, applied to the endpoints the filter shows;
- two layouts, which the browser remembers.

The new key is shown once in a banner.

"New endpoint" and "Edit endpoint" open a builder whose form and JSON definition edit the same
document. A key you add by hand in the JSON is never dropped by a form change. While the JSON has
unapplied edits, the form is locked and Save waits. A save that would break a live key says which
key.
