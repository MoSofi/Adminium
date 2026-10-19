---
'@adminium/server': patch
---

The daily trash purge now always finishes. Before, a run of 100 trashed files that could not be removed from storage (for example a bucket whose credentials were revoked) made it retry the same files forever, and 100 old trashed exports could stop it before it reached the uploads behind them.
