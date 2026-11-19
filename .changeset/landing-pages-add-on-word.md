---
'@adminium/manifest': patch
'@adminium/add-on-contracts': patch
'@adminium/server': patch
---

Add-ons can now declare landing pages, with the new manifest word `addOn.landing` (it needs Adminium 0.3.65 or later). The add-on names its pages table and its funnels table, which must hold the columns the contract lists; `@adminium/add-on-contracts/landing` describes the page document, its blocks, its links and the slugs a page may not use (words like `login`, `account`, `admin` or `billing`), and `@adminium/add-on-contracts/landing/render` draws a page.

Adminium seals the publishing of a page, whoever writes the row and through whatever door: a page goes live only if its published copy reads as a whole page (422 `landing-unparsable`), carries no block Milo wrote that nobody has looked at (422 `landing-marked`), and sits at an allowed address no other live page holds (422 `landing-slug`). Milo may write a draft but never publish one (403 `landing-assistant`). When a page was published is always set by Adminium, never taken from the request.
