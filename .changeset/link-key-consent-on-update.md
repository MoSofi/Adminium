---
'@adminium/server': patch
---

An app whose only public door is a shared link's own key (a quote opened by its code) now has its public access follow an update as an app with a guest key does: an endpoint the update widens is saved when the update is allowed to widen it (`publicWider: true`), without also sending `publicAccess: true`. Before, the update went through but left the endpoint as it was, and the next update asked again. The same holds when an app is applied again from its folder.
