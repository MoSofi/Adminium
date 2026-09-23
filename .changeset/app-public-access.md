---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/public-client': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

**Apps can ask for public access for their guests, and staff sign in on the app's own address.**

At install you see — and may untick — what an app's guests will be able to do (allowing it needs
**Manage API keys**): which tables
they read or write, through which methods and fields. Adminium makes the app its own browser
key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
"free" or "full" per time and nothing more; two guests booking the last seats at once get one
confirmation and one "full". A guest finds their own booking by its code and mobile number (the
number compared by its digits, however it was typed). Public replies give times as instants, so
a guest in another time zone sees the venue's time. `@adminium/public-client` gains
`availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
`PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).

On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
out right to left before anyone signs in.
