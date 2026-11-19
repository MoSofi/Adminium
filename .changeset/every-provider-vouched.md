---
'@adminium/server': patch
'@adminium/dashboard': patch
---

Every add-on contract whose code Adminium imports, and every add-on's event code, now loads only from a package Adminium can vouch for (one this build bundles, one downloaded from the catalogue, a kept copy of one of those, or a developer key outside production), not just payment providers and card readers. An add-on's server code runs inside Adminium and may be handed the owner's keys, so a package uploaded by hand from now on that provides any of them (artwork sources, delivery companies, personalisation, documents, the new company sources, event code) is left out by name and its code is never run. Uploading one says so at once, as the check before installing does, and the Add-ons page says on its row that its code did not load, with the way back: install it from the catalogue.

What already ran keeps running. A package installed before this update that had no trust record (staged by Adminium 0.3.17 or older and never updated since, or uploaded by hand on a server with no catalogue) is recorded as trusted once, at the first start of this release, by the hash of its files as they were unpacked, so its document kinds, artwork sources, personaliser or carrier do not vanish at the update. A package whose files were changed on disk since it was unpacked is not, and nor is anything uploaded after that first start. A manifest that uses the new words for finding companies is refused by this release with the release that runs them.
