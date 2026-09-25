---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

A column with a `code` rule is shown to the staff who read its table, even when its name reads like a secret. A studio's `share_token` holds the handover link Adminium made to be sent, but a name with `token` in it was taken for a secret and left out of every answer, admins' included: the desk could not show or copy the link, and "Make a new link" answered without the new code. Now the list, the record, a new record and the new link's answer all carry it, and a new record gets its code when it is made. The public side still never shows it unless an entry names it: an entry or a generated endpoint that names no columns leaves codes out, and the page a shared link opens can never show, filter, search or order by the link's own code. A manifest column may also say `secret: true` or `secret: false` to settle the guess Adminium makes from its name, as `personal` does for personal data. A Studio save that stops any column being a secret needs Super Admin, as turning off a personal-data mask does.
