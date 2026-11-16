---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A refund in the Payment panel and in its list read (`/payments/panel`, `/payments/panel/rows`) says who asked for it and why — `by` (the person's name), `reason` and `note` — to someone who may see payments or refund that payment, and to nobody else. A refund made by itself, in the service's dashboard, by a lost dispute or from an app's own refund row names no one. The panel shows "By {person} · {reason}" under the refund (8 languages).
