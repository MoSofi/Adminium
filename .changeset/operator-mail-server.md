---
'@adminium/server': patch
'@adminium/dashboard': patch
---

An installation that is not a trial can send its mail through the operator's mail server (`ADMINIUM_OPERATOR_SMTP_URL` and `ADMINIUM_OPERATOR_MAIL_FROM`) while it has no mail server of its own, From the pinned address as "<name> via <operator>", with the mail people write capped at `ADMINIUM_OPERATOR_EMAIL_MAX_PER_DAY` a day (default 500) and account mail never counted. Settings → Mail shows it with the cap; saving its own mail server moves all mail there with no cap, and removing it falls back to the operator's.
