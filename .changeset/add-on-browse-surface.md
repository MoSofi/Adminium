---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/i18n': patch
---

Browsing add-ons is a browse surface now, not a list of slugs.

**Two defects, both in the catalog projection.** The browse route derived a
catalog row's name as `entry.name['en_US']`, but the feed keys rows `en`, `de`,
`zh-cn` — `en_US` has never been present, so the fallback fired every time and
every online add-on was labelled with its own slug (`barcode-labels`, not
`Barcode Labels`). Fixing that one key would still have thrown away the seven
other translations the feed already carries, so the row is now resolved against
the caller's locale: exact tag, then the normalised tag (`zh_CN` → `zh-cn`, the
leg without which both Chinese locales silently render English), then the
language subtag, then `en`.

**The reply carries what the cache already held.** `categories`, `tagline` and
`connectKind` were parsed from the feed, cached to disk, and then projected away.
They are now in the DTO, so the page can show what an add-on is and whether
installing will ask for a credential — the one permission-shaped fact on a card,
with everything else about an add-on's reach left to the install plan, which is
the security surface.

**The page is the comp again.** `designs/Integrations.dc.html` draws a category
rail with per-category counts, a search box and a card grid; the shipped page
rendered a flat list of names. The browse half moves to its own component and
gains all three, plus distinct empty states for "this build shipped none",
"nothing matched your filter" and "the catalog is on but found nothing".

Browsing remains a disk read: no page load, category click or search makes an
outbound request.
