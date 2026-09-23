---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
---

**"Keep me signed in" now does what it says.**

The box on the sign-in page, and **Keep me signed in on this tablet** on an app's
staff address, was collected and never sent: every sign-in got the same 30-day
cookie whatever it said. The box now starts ticked, as the designs draw it.
Ticked, the session survives closing the browser, as before. Unticked, the
session cookie has no `Max-Age`, so the browser drops it when it closes.

`POST /api/v1/auth/login` takes an optional `remember` boolean. `false` gives
the browser-session cookie; `true` or leaving it out gives the long-lived
cookie, so API clients that never send it are unaffected. The answer is given
once: a two-factor sign-in carries it through `/auth/2fa/verify`, and changing
your password keeps it, so an unticked sign-in on a shared computer is never
turned into a 30-day one.

Only the cookie changes. The session still ends after 7 days without use or at
the workspace's session limit either way, and a browser that restores its last
tabs may bring back an unticked session too.

Meta migration `0041_session_persistent` adds `adminium_sessions.persistent`
(default true, so every existing session stays long-lived).
