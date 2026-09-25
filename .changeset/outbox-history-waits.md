---
'@adminium/server': patch
'@adminium/manifest': patch
---

An app's outbox sends only what it made or a person approved. A message an import or an undo brings back waiting to go now waits for a person (held, or failed to queue again) instead of going by itself; one approved with no day worked out goes at once instead of never; and a batched message is dropped or overtaken like any other while its window is open. A batch takes its window as its due, so a manifest may no longer give it another.
