---
'@adminium/server': patch
---

**A password-reset link can no longer be pointed at another site.** A reset
email's link took its host from the request that asked for it: the `Origin`
header when there was one, otherwise the request's scheme and `Host`.
`POST /api/v1/auth/password/forgot` needs no sign-in. Anyone who knew a user's
email address could send `Origin: https://their-site.example` and Adminium
mailed that user a genuine reset email whose link, with a working token,
pointed at the sender's site. One click handed over the account. Invitations
(`POST /users`, including from an API key), test sends and `url` file
references built their links the same way.

Those links now use a new instance setting, **Address in email links**
(`system.publicOrigin`), under Studio → Settings → Email. It fills itself in
from the browser of an admin who can manage settings, the next time that admin
finishes first-run setup, signs in or saves a change. It is never filled in
from `localhost`, and a configuration bundle never carries it. The audit log
records each time it is filled in. Until it is known, links use the host the
request was sent to and never the `Origin` header, and `X-Forwarded-Host` still
counts only from a trusted proxy. If Adminium's port can be reached without
your proxy, set the address yourself: a direct caller chooses its own `Host`.

`GET` and `PUT /api/v1/settings/email` gain `publicOrigin`. `PUT` refuses a
value with a path, a query, credentials or a scheme other than http(s) with a
422, and `null` clears it.
