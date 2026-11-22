---
'@adminium/server': patch
'@adminium/meta': patch
---

Four security and privacy fixes. An invitation link now works only while the account is still invited, a new invitation retires the person's earlier links, a new password-reset link retires earlier reset links, and using any link retires the rest. Password and invitation links no longer reach the request log. Holding `exports.manage` no longer opens another person's export of a table you cannot read. Notifications are now deleted once they have been read for longer than `retention.notificationsDays` (90 days by default); unread ones are kept.
