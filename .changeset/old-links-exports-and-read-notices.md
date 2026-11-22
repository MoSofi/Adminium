---
'@adminium/server': patch
'@adminium/meta': patch
---

An invitation link works only while the account is still invited, a new invitation retires the person's earlier links, a new password-reset link retires earlier reset links, and using any link retires the rest. Password and invitation links stay out of the request log. Another person's export opens only for someone who holds `exports.manage` and can read its whole table. Notifications are deleted once they have been read for longer than `retention.notificationsDays` (90 days by default); unread ones are kept.
