---
'@adminium/server': patch
---

**A phone number written as `(415) 555-0132` passes a phone-format rule.**

A column set to accept phone numbers refused one that starts with an area code in brackets, the
usual way to write a North American number. It is accepted now, like `+1 415 555 0132` always was.
