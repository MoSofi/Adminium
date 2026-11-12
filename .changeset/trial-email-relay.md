---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/meta': patch
---

A trial instance now sends all of its email, and only through the operator's mail relay (`ADMINIUM_TRIAL_SMTP_URL`). Every mail goes from the address the relay pins for the instance (the new `ADMINIUM_TRIAL_MAIL_FROM`) as "<instance name> via <operator name>" (the new `ADMINIUM_OPERATOR_NAME`); an instance name holding a brand or an account-safety word, in any spelling, gives way to the instance's host name. Mail the person wrote gets a staff member's own address as its Reply-To and a footer naming the instance's address with a link to report it (the new `ADMINIUM_TRIAL_MAIL_REPORT_URL`, by default `mailto:abuse@` the relay's domain). Account email (password reset, invitation, sign-in code, address changed) says the shipped words and has its own quota of 50 a day and 20 an hour. Mail the person wrote is capped at `ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY` a day, 20 an hour and 20 different people a day: past a cap it waits in the outbox and goes out when the window opens, and five bounces or one spam report in a day hold it until the next. Marketing mail and campaigns are off. Studio's Email card shows the relay read-only, marked "Set by the operator", with today's use, a warning while mail waits, and the list of waiting emails (`GET /api/v1/settings/email/waiting`); a change to the mail server is refused (409 `SET_BY_OPERATOR`). The operator endpoint now reports the emails sent today and this hour. Ordinary and hosted installations are unchanged.
