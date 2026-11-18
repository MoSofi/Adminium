---
'@adminium/server': patch
---

A card reader add-on now loads only from a package Adminium can vouch for (one this build bundles, one downloaded from the catalogue, or a developer key outside production), as a payment provider already did. A card reader package is handed the shop's reader keys and takes payments in person, so a hand-uploaded look-alike is now left out by name and its code is never run. The Square card readers add-on is bundled and catalogue-verified, so nothing changes for it.
