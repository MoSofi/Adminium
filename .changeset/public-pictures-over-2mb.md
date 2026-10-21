---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

A picture over 2 MB on a customer page no longer shows as a broken image: it is served as a smaller copy. A picture too big for customers to be shown is refused where it is uploaded or chosen, and the field says why, in every language. `adminium app check` warns about a picture column whose file limit is above what customers can be shown, and the Designer no longer writes one.
