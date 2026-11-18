---
'@adminium/server': patch
'@adminium/dashboard': patch
---

An app's page no longer jumps when its "Sample data is loaded" banner appears. The banner used to be asked for only after the page had drawn, so it arrived after the cards and pushed them down by about 55 px. Whether the sample data is loaded is now asked together with the page itself, so the banner's place is kept above the cards from the first moment, and the banner fills it without moving them. Only people who manage apps are asked, as before.
