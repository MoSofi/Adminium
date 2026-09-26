---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The install wizard's Public access card now words both of a sign-in-link app's warnings in the studio's language. "This app has no public address, so no sign-in link can be sent" used to show in English in every locale. And with email not set up, a sign-in-link app was told its guests would get no confirmation, when what actually fails is that nobody can be sent a sign-in link. The server now sends that warning under its own code, `NO_EMAIL_SIGN_IN`, instead of `NO_EMAIL`.
