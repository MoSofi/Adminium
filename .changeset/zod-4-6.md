---
"@adminium/server": patch
---

Adminium now uses zod 4.6.7, which fixes a memory-exhaustion advisory, and the dashboard loads its page-document checks with the first page instead of on every first paint. A moment sent with a zone (a record's `occurredAt`, a price tried `at`) now carries its seconds, as RFC 3339 writes it: `2026-10-02T19:04:00+02:00`, not `2026-10-02T19:04+02:00`.
