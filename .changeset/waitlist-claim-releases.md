---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A waitlist claim can release the places it took. With `reserved: { "states": ["returned"], "releaseTo": "released" }`, an offer claimed moves as many of its pool's returned tickets to `released` as places it takes, in the same write and under the same lock. Before, the returned tickets stayed kept after the claim: the public read the show as sold out while places were free, and the box office's count of places "back for the waitlist" was too high.
