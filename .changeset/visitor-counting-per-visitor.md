---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Visitor counting has a third level, "Per visitor", which remembers the pages one visitor saw once they say yes. It is never on by default, and it can only be chosen once your privacy notice is set. At this level a banner asks the visitor on a form's own page and on your landing pages, on your own addresses only, never inside a frame on another website. A "Yes" sets one cookie, `__Host-adm_v` (180 days, this host only); a "No" is kept only in the visitor's browser and nothing is stored. "Cookie choice" in the page's footer lets a visitor take a yes back at any time. The banner comes in eight languages, and you can write your own words for it.

When a visitor who said yes sends a form, the pages they saw are joined to the address they gave: they show as "Pages they saw" in that person's data, and go with them when they are erased. Visits are kept 6 months by default. Going down from "Per visitor" to a lower level deletes every visitor and every visit at once.
