---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/public-client': patch
---

**An app can have a second key for a kiosk, bound to a signed-in staff member.**

A kiosk's key is served only to the screen of a staff member holding the app's kiosk role (a
screens-only role with no data), and answers only beside that sign-in, from the same page, with
its CSRF token on writes, and on the app's own staff host when one is mapped. The app switches it
off from its settings row (`PUBLIC_KEY_OFF`); it stops with the staff side. Sessions found at a
kiosk last three minutes, ask no proof of work, and count per screen. An app update rebinds it,
revokes it when the app drops it, and never re-makes one an operator revoked. The API keys page
marks it "Staff screen only".

Also fixed: a staff member signed in on the same browser no longer breaks an app's public pages
(the public API's requests are the key's, not the cookie's), and a screens-only person may call the
public API.
