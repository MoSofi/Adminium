---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Workspace settings links to Add-ons. `/studio/add-ons` shipped with a route and
no inbound link: the avatar menu lists only Data connections and Workspace
settings, and no page navigated to it — so the whole add-on surface (browse,
consent, install, connect, sideload) was reachable only by typing the URL, while
the self-hosting docs told operators to open it from a menu. It is now a row in
the settings cross-link card, beside Pages, AI enrichment and Storage, on the
same Admin+ reasoning: the routes guard on `system:manifests:manage` and the
page answers a 403 itself, so an admin who could hold the permission finds the
door rather than a hidden one.
