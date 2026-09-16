---
'@adminium/server': patch
'@adminium/desktop': patch
---

**The bundled add-on set moves to 1.0.1, and gains Invoices.** The Docker image
and the desktop app now bake in seven add-ons instead of six — barcode-labels,
design-studio, holiday-calendars, import-canva, **invoices**, personalizer and
shipping-dhl — fetched at build time from `downloads.adminium.dev` against the
fingerprints the release recorded.

Each of these releases also states the oldest Adminium it runs on truthfully;
the 1.0.0 files all claimed `1.0.0`, which no released server has ever been.
Nothing enforces that claim for add-ons yet, but the shipped set no longer lies
about it.
