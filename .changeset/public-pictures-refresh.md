---
'@adminium/server': patch
'@adminium/manifest': patch
---

A picture on an app's public pages (a dish, an event poster) is now kept by browsers and caches for five minutes instead of a week, and then asked for again by its tag, which costs nothing while it is still shown. A dish taken off the menu, or an event moved back to draft, stops showing within minutes. A picture is also never served from records only a signed-in guest may read: the picture route answers them as it answers a missing picture, and an app that asks for `pictures` on such an entry is refused.
