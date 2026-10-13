---
'@adminium/server': patch
---

An app whose only public door is a shared link (a quote its customer opens by the link in an e-mail) can now have a customer side: the side's config is served with the link's own key where the app has no `customer` key. Before, the page behind the link could not load.
