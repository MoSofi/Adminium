---
'@adminium/server': patch
---

Every add-on contract whose code Adminium imports now loads only from a package Adminium can vouch for (one this build bundles, one downloaded from the catalogue, or a developer key outside production), not just payment providers and card readers. An add-on's server code runs inside Adminium and may be handed the owner's keys, so a hand-uploaded package that provides any of them (artwork sources, delivery companies, personalisation, documents, and the new company sources) is left out by name and its code is never run. Every first-party add-on is bundled or catalogue-verified, so nothing changes for them. A manifest that uses the new words for finding companies is refused by this release with the release that runs them.
