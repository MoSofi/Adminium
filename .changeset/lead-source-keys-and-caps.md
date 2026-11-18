---
'@adminium/server': patch
'@adminium/meta': patch
---

An add-on that finds companies through several services keeps one key per service, saved, replaced, removed and checked one at a time on its Sources screen, with only the last four characters shown and the service's answer read as accepted, refused or can't reach. Each service has its own switch, a daily cap (100 calls for a paid one unless the owner sets another), a share of that cap for any one person, and a budget of 50 calls a day for automation rules (never more than the source's own cap); every call reserves before it runs, so calls at once never pass a cap together. A service that answers "too many" is left alone for the time it names, and only that service. Each call is handed only that service's key and a client that reaches only that service's hosts. The audit log names the service, never the key. The generic Connect form refuses such an add-on, as it refuses a payment service, and the Add-ons page lists the hosts each source may contact.
